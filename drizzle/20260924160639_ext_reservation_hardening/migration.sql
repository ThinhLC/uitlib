-- [Ext] Reservation hardening (review of the Phase 10 flows, 2026-09-24):
-- - sp__expire_hold: one hold expiry in its own transaction, shared by the batch and checkout.
-- - sp__expire_holds_batch skips a hold that hits a lock wait timeout or deadlock (1205/1213)
--   instead of stopping the whole run.
-- - sp_checkout expires overdue holds on the scanned copies before its own transaction, so the
--   expiry stands even when the checkout is rejected; an on_hold copy with no ready reservation
--   (broken I-2) is refused with COPY_STATE instead of being lent.
-- - sp_reserve: only an active reader with a valid card joins a queue.
-- - sp_cancel_reservation: permission is checked before NOT_FOUND.

CREATE PROCEDURE `sp__expire_hold`(
  IN p_reservation_id BIGINT,
  IN p_now DATETIME(3),
  OUT p_expired BOOLEAN)
SQL SECURITY DEFINER
COMMENT 'Internal [Ext]: expire one ready hold past its expiry and promote the queue, in its own transaction'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_until DATETIME(3);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET p_expired = FALSE;
  -- Immutable book; the assigned copy only decides which copy to lock and is re-checked below.
  SELECT book_id, assigned_copy_id INTO v_book, v_copy FROM reservations WHERE id = p_reservation_id;
  IF v_copy IS NOT NULL THEN
    START TRANSACTION;
    SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
    SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
    SELECT status, hold_expires_at INTO v_status, v_until FROM reservations WHERE id = p_reservation_id FOR UPDATE;
    IF v_status = 'ready' AND v_until <= p_now THEN
      UPDATE reservations
         SET status = 'expired', closed_at = p_now, closed_by_kind = 'system', close_reason = 'hold_expired'
       WHERE id = p_reservation_id;
      CALL sp__promote_queue(v_copy, NULL, p_now);
      SET p_expired = TRUE;
    END IF;
    COMMIT;
  END IF;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp__expire_holds_batch`;
--> statement-breakpoint
CREATE PROCEDURE `sp__expire_holds_batch`(
  IN p_now DATETIME(3),
  OUT p_count INT)
SQL SECURITY DEFINER
COMMENT 'Internal [Ext]: expire every ready hold past its expiry, one transaction per hold (cursor)'
BEGIN
  DECLARE v_done BOOLEAN DEFAULT FALSE;
  DECLARE v_res BIGINT;
  DECLARE v_expired BOOLEAN;
  DECLARE c_holds CURSOR FOR
    SELECT id FROM reservations
     WHERE status = 'ready' AND hold_expires_at <= p_now
     ORDER BY book_id, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

  SET p_count = 0;
  OPEN c_holds;
  expire: LOOP
    FETCH c_holds INTO v_res;
    IF v_done THEN
      LEAVE expire;
    END IF;
    -- A hold whose rows are busy (lock wait timeout or deadlock) is skipped: sp__expire_hold has
    -- rolled it back, and the next run (or the holder's next scan) retries it. Other errors stop the run.
    one_hold: BEGIN
      DECLARE EXIT HANDLER FOR 1205, 1213 BEGIN END;
      CALL sp__expire_hold(v_res, p_now, v_expired);
      IF v_expired THEN
        SET p_count = p_count + 1;
      END IF;
    END one_hold;
    SET v_done = FALSE;
  END LOOP;
  CLOSE c_holds;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_checkout`;
--> statement-breakpoint
CREATE PROCEDURE `sp_checkout`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_copy_ids JSON)
SQL SECURITY DEFINER
COMMENT 'Lend one or more copies to a reader; returns loan_id, loan_item_id, copy_id, due_at'
BEGIN
  DECLARE v_n INT DEFAULT 0;
  DECLARE v_distinct INT DEFAULT 0;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_id BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_material BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_reader_status VARCHAR(16);
  DECLARE v_reader_type BIGINT;
  DECLARE v_cards INT DEFAULT 0;
  DECLARE v_copy_status VARCHAR(16);
  DECLARE v_books INT DEFAULT 0;
  DECLARE v_types INT DEFAULT 0;
  DECLARE v_policy BIGINT;
  DECLARE v_loan_days SMALLINT;
  DECLARE v_max_renewals SMALLINT;
  DECLARE v_fee BIGINT;
  DECLARE v_threshold BIGINT;
  DECLARE v_max_items SMALLINT;
  DECLARE v_assessed BIGINT DEFAULT 0;
  DECLARE v_adjusted BIGINT DEFAULT 0;
  DECLARE v_allocated BIGINT DEFAULT 0;
  DECLARE v_overdue INT DEFAULT 0;
  DECLARE v_open INT DEFAULT 0;
  DECLARE v_requested INT DEFAULT 0;
  DECLARE v_loan BIGINT;
  DECLARE v_res BIGINT;
  DECLARE v_holder BIGINT;
  DECLARE v_hold_until DATETIME(3);
  DECLARE v_held INT DEFAULT 0;
  DECLARE v_expired BOOLEAN;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
    RESIGNAL;
  END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.checkout') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.checkout required';
  END IF;
  IF p_copy_ids IS NULL OR JSON_TYPE(p_copy_ids) <> 'ARRAY' OR JSON_LENGTH(p_copy_ids) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: copy_ids must be a non-empty JSON array';
  END IF;
  SELECT COUNT(*), COUNT(DISTINCT j.id) INTO v_n, v_distinct
    FROM JSON_TABLE(p_copy_ids, '$[*]' COLUMNS (id BIGINT PATH '$' ERROR ON ERROR)) AS j;
  IF v_n <> v_distinct THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: copy_ids must be distinct';
  END IF;

  DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
  CREATE TEMPORARY TABLE tmp_checkout (
    copy_id BIGINT PRIMARY KEY,
    book_id BIGINT NULL,
    material_type_id BIGINT NULL,
    policy_id BIGINT NULL,
    loan_days SMALLINT NULL,
    max_renewals SMALLINT NULL,
    daily_fee BIGINT NULL,
    threshold BIGINT NULL,
    max_items SMALLINT NULL,
    on_hold TINYINT NOT NULL DEFAULT 0,
    reservation_id BIGINT NULL);
  INSERT INTO tmp_checkout (copy_id)
  SELECT j.id FROM JSON_TABLE(p_copy_ids, '$[*]' COLUMNS (id BIGINT PATH '$')) AS j;

  -- 0. [Ext] Expire overdue holds on the requested copies first, each in its own committed
  --    transaction (FR-014c "on demand when scanned"), so the expiry stands even if this checkout
  --    is then rejected. Step 6b re-checks under the checkout's own locks.
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SET v_res = NULL;
    SELECT id INTO v_res FROM reservations WHERE ready_copy_id = v_id AND hold_expires_at <= p_now;
    IF v_res IS NOT NULL THEN
      CALL sp__expire_hold(v_res, p_now, v_expired);
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  START TRANSACTION;

  -- 1. Reader (first read after START TRANSACTION, and a locking one).
  SELECT status, reader_type_id INTO v_reader_status, v_reader_type
    FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_reader_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
  END IF;
  IF v_reader_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'READER_NOT_ACTIVE: reader is suspended or inactive';
  END IF;

  -- 2. Card valid at the borrow time.
  SELECT COUNT(*) INTO v_cards FROM library_cards
   WHERE reader_id = p_reader_id AND status = 'active' AND expires_at > p_now FOR SHARE;
  IF v_cards = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CARD_INVALID: no active, unexpired card';
  END IF;

  -- 3. Resolve each copy's book (immutable ids; this read only decides the lock order).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SET v_book = NULL, v_material = NULL;
    SELECT c.book_id, b.material_type_id INTO v_book, v_material
      FROM book_copies c JOIN books b ON b.id = c.book_id WHERE c.id = v_id;
    IF v_book IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: copy';
    END IF;
    UPDATE tmp_checkout SET book_id = v_book, material_type_id = v_material WHERE copy_id = v_id;
    SET v_i = v_i + 1;
  END WHILE;

  -- 4. Lock the books in ascending id.
  SELECT COUNT(DISTINCT book_id) INTO v_books FROM tmp_checkout;
  SET v_i = 0;
  WHILE v_i < v_books DO
    SELECT DISTINCT book_id INTO v_id FROM tmp_checkout ORDER BY book_id LIMIT v_i, 1;
    SELECT id INTO v_locked FROM books WHERE id = v_id FOR UPDATE;
    SET v_i = v_i + 1;
  END WHILE;

  -- 5. Lock the copies in ascending id; each must be available, or [Ext] on hold (resolved in 6b).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = v_id FOR UPDATE;
    IF v_copy_status = 'on_hold' THEN
      UPDATE tmp_checkout SET on_hold = 1 WHERE copy_id = v_id;
    ELSEIF v_copy_status <> 'available' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_NOT_AVAILABLE: a requested copy is not available';
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  -- 6. The policy version in effect at the borrow time, per material type (shared lock, R-09f).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id, material_type_id INTO v_id, v_material FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SET v_policy = NULL;
    SELECT id, loan_days, max_renewals, daily_late_fee_vnd, debt_block_threshold_vnd, max_active_items
      INTO v_policy, v_loan_days, v_max_renewals, v_fee, v_threshold, v_max_items
      FROM loan_policies
     WHERE reader_type_id = v_reader_type AND material_type_id = v_material
       AND valid_from <= p_now AND (valid_to IS NULL OR valid_to > p_now)
     FOR SHARE;
    IF v_policy IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_POLICY: no policy version covers this reader type and time';
    END IF;
    UPDATE tmp_checkout
       SET policy_id = v_policy, loan_days = v_loan_days, max_renewals = v_max_renewals,
           daily_fee = v_fee, threshold = v_threshold, max_items = v_max_items
     WHERE copy_id = v_id;
    SET v_i = v_i + 1;
  END WHILE;

  -- 6b. [Ext] Held copies (lock order: … policy → reservation), looked up by the unique
  --     ready_copy_id. A hold that expired after step 0 is expired here within this transaction.
  --     Only the holder may borrow a held copy (R-14f).
  SELECT COUNT(*) INTO v_held FROM tmp_checkout WHERE on_hold = 1;
  SET v_i = 0;
  WHILE v_i < v_held DO
    SELECT copy_id INTO v_id FROM tmp_checkout WHERE on_hold = 1 ORDER BY copy_id LIMIT v_i, 1;
    SET v_res = NULL;
    SELECT id, reader_id, hold_expires_at INTO v_res, v_holder, v_hold_until
      FROM reservations WHERE ready_copy_id = v_id FOR UPDATE;
    IF v_res IS NOT NULL AND v_hold_until <= p_now THEN
      UPDATE reservations
         SET status = 'expired', closed_at = p_now, closed_by_kind = 'system', close_reason = 'hold_expired'
       WHERE id = v_res;
      CALL sp__promote_queue(v_id, p_actor_user_id, p_now);
      SET v_res = NULL;
      SELECT id, reader_id INTO v_res, v_holder FROM reservations WHERE ready_copy_id = v_id FOR UPDATE;
    END IF;
    IF v_res IS NULL THEN
      -- Promotion may have released the copy; on_hold with no ready reservation breaks I-2.
      SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = v_id FOR UPDATE;
      IF v_copy_status = 'on_hold' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy is on hold without a ready reservation';
      END IF;
    ELSE
      IF v_holder <> p_reader_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_NOT_AVAILABLE: the copy is held for another reader';
      END IF;
      UPDATE tmp_checkout SET reservation_id = v_res WHERE copy_id = v_id;
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  -- 7. Outstanding debt, from locking reads (not fn_reader_outstanding; research R5).
  SELECT COALESCE(SUM(f.assessed_amount_vnd), 0) INTO v_assessed
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT COALESCE(SUM(a.amount_vnd), 0) INTO v_adjusted
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
    JOIN fine_adjustments a ON a.fine_id = f.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT COALESCE(SUM(x.amount_vnd), 0) INTO v_allocated
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
    JOIN fine_payment_allocations x ON x.fine_id = f.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT MIN(threshold) INTO v_threshold FROM tmp_checkout;
  IF v_assessed + v_adjusted - v_allocated > v_threshold THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEBT_BLOCKED: outstanding debt is above the threshold';
  END IF;

  -- 8. No overdue item (D7).
  SELECT COUNT(*) INTO v_overdue
    FROM loans l JOIN loan_items li ON li.loan_id = l.id
   WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND li.due_at < p_now FOR SHARE;
  IF v_overdue > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OVERDUE_BLOCKED: reader has an overdue item';
  END IF;

  -- 9. Item limit per material type.
  SELECT COUNT(DISTINCT material_type_id) INTO v_types FROM tmp_checkout;
  SET v_i = 0;
  WHILE v_i < v_types DO
    SELECT DISTINCT material_type_id INTO v_material FROM tmp_checkout ORDER BY material_type_id LIMIT v_i, 1;
    SELECT COUNT(*), MAX(max_items) INTO v_requested, v_max_items FROM tmp_checkout WHERE material_type_id = v_material;
    SELECT COUNT(*) INTO v_open
      FROM loans l
      JOIN loan_items li ON li.loan_id = l.id
      JOIN book_copies c ON c.id = li.copy_id
      JOIN books b ON b.id = c.book_id
     WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND b.material_type_id = v_material
       FOR SHARE;
    IF v_open + v_requested > v_max_items THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIMIT_REACHED: too many items on loan';
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  -- 10. Write: loan, items (policy snapshot), then copies (research R4 write order).
  INSERT INTO loans (reader_id, processed_by_user_id, borrowed_at, status, created_at)
  VALUES (p_reader_id, p_actor_user_id, p_now, 'open', p_now);
  SET v_loan = LAST_INSERT_ID();
  INSERT INTO loan_items
    (loan_id, copy_id, policy_id, borrowed_at, due_at, status, renewal_count,
     applied_loan_days, applied_max_renewals, applied_daily_fee_vnd)
  SELECT v_loan, copy_id, policy_id, p_now, fn_due_at(p_now, loan_days), 'on_loan', 0,
         loan_days, max_renewals, daily_fee
    FROM tmp_checkout ORDER BY copy_id;
  -- [Ext] The holder's reservations are fulfilled by the new loan items (before the copies leave on_hold).
  UPDATE reservations r
    JOIN tmp_checkout t ON t.reservation_id = r.id
    JOIN loan_items li ON li.loan_id = v_loan AND li.copy_id = t.copy_id
     SET r.status = 'fulfilled', r.fulfilled_loan_item_id = li.id, r.closed_at = p_now,
         r.closed_by_kind = 'staff', r.closed_by_user_id = p_actor_user_id;
  UPDATE book_copies c JOIN tmp_checkout t ON t.copy_id = c.id
     SET c.circulation_status = 'on_loan', c.updated_at = p_now;
  COMMIT;

  DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
  SELECT loan_id, id AS loan_item_id, copy_id, due_at FROM loan_items WHERE loan_id = v_loan ORDER BY id;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_reserve`;
--> statement-breakpoint
CREATE PROCEDURE `sp_reserve`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_book_id BIGINT,
  OUT p_reservation_id BIGINT)
SQL SECURITY DEFINER
COMMENT '[Ext] Reserve a book: only when no copy is available and the reader has none on loan (D6)'
BEGIN
  DECLARE v_locked BIGINT;
  DECLARE v_available INT DEFAULT 0;
  DECLARE v_on_loan INT DEFAULT 0;
  DECLARE v_reader_status VARCHAR(16);
  DECLARE v_cards INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  -- Staff with reservation.manage, or the reader's own active account.
  IF NOT fn_has_permission(p_actor_user_id, 'reservation.manage')
     AND NOT EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
                      WHERE r.id = p_reader_id AND u.id = p_actor_user_id AND u.status = 'active') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required, or reserve for yourself';
  END IF;

  START TRANSACTION;
  SELECT id, status INTO v_locked, v_reader_status FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
  END IF;
  -- Only a reader who could borrow joins a queue (the same hard checks as promotion, D4).
  IF v_reader_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'READER_NOT_ACTIVE: reader is suspended or inactive';
  END IF;
  SELECT COUNT(*) INTO v_cards FROM library_cards
   WHERE reader_id = p_reader_id AND status = 'active' AND expires_at > p_now FOR SHARE;
  IF v_cards = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CARD_INVALID: no active, unexpired card';
  END IF;
  SET v_locked = NULL;
  SELECT id INTO v_locked FROM books WHERE id = p_book_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: book';
  END IF;
  SELECT COUNT(*) INTO v_available FROM book_copies
   WHERE book_id = p_book_id AND circulation_status = 'available' FOR SHARE;
  IF v_available > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: the book has an available copy; borrow it instead';
  END IF;
  SELECT COUNT(*) INTO v_on_loan
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN book_copies c ON c.id = li.copy_id
   WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND c.book_id = p_book_id FOR SHARE;
  IF v_on_loan > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: the reader already has this book on loan';
  END IF;

  -- A second waiting/ready reservation for (reader, book) fails on reservations_active_uq (R-14a).
  INSERT INTO reservations (reader_id, book_id, requested_at, status)
  VALUES (p_reader_id, p_book_id, p_now, 'waiting');
  SET p_reservation_id = LAST_INSERT_ID();
  COMMIT;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_cancel_reservation`;
--> statement-breakpoint
CREATE PROCEDURE `sp_cancel_reservation`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reservation_id BIGINT,
  IN p_reason VARCHAR(500))
SQL SECURITY DEFINER
COMMENT '[Ext] Cancel a waiting or ready reservation; a ready one passes its copy to the queue'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_copy BIGINT;
  DECLARE v_kind VARCHAR(8);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  -- Immutable ids (the trigger forbids changing reader or book); they decide permission and locks.
  SELECT reader_id, book_id INTO v_reader, v_book FROM reservations WHERE id = p_reservation_id;
  -- Permission first: a reader account learns nothing about reservations that are not its own.
  IF fn_has_permission(p_actor_user_id, 'reservation.manage') THEN
    SET v_kind = 'staff';
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: staff cancellation needs a reason';
    END IF;
    IF v_reader IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reservation';
    END IF;
  ELSEIF v_reader IS NOT NULL
     AND EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
                  WHERE r.id = v_reader AND u.id = p_actor_user_id AND u.status = 'active') THEN
    SET v_kind = 'reader';
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required, or cancel your own';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT status, assigned_copy_id INTO v_status, v_copy FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_status NOT IN ('waiting', 'ready') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: reservation is ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  IF v_status = 'ready' THEN
    SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
  END IF;

  UPDATE reservations
     SET status = 'cancelled', closed_at = p_now, closed_by_kind = v_kind, closed_by_user_id = p_actor_user_id,
         close_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'cancelled_by_reader')
   WHERE id = p_reservation_id;
  IF v_status = 'ready' THEN
    CALL sp__promote_queue(v_copy, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END;
