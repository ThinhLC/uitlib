-- [Ext] Queue promotion (tasks T095; spec FR-014b, FR-006a, D4 hold window 3 days).
-- sp__promote_queue is internal (not granted). The Core procedures below are re-created so their
-- [Ext] extension points call it (return, new copy, repair done / found) or accept holds (checkout).

CREATE PROCEDURE `sp__promote_queue`(
  IN p_copy_id BIGINT,
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3))
SQL SECURITY DEFINER
COMMENT 'Internal [Ext]: give a lendable copy to the first eligible waiting reservation, else make it available'
BEGIN
  -- FR-014b. The caller holds the book and copy locks, and the copy is lendable (good or worn):
  -- just returned, registered, repaired, found, or its hold just ended.
  DECLARE v_book BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_waiting INT DEFAULT 0;
  DECLARE v_res BIGINT;
  DECLARE v_reader BIGINT;
  DECLARE v_reader_status VARCHAR(16);
  DECLARE v_cards INT DEFAULT 0;
  DECLARE v_none BOOLEAN DEFAULT FALSE;
  -- A SELECT … INTO that finds no row must not reach a caller's NOT FOUND handler (cursor loops).
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_none = TRUE;

  SELECT book_id, circulation_status INTO v_book, v_status FROM book_copies WHERE id = p_copy_id;
  -- Lock the whole queue in queue order (last in the global lock order).
  SELECT COUNT(*) INTO v_waiting FROM reservations
   WHERE book_id = v_book AND status = 'waiting' FOR UPDATE; -- scans reservations_queue_ix in queue order

  promote: LOOP
    SET v_none = FALSE, v_res = NULL;
    SELECT id, reader_id INTO v_res, v_reader FROM reservations
     WHERE book_id = v_book AND status = 'waiting' ORDER BY requested_at, id LIMIT 1 FOR UPDATE;
    IF v_none OR v_res IS NULL THEN
      IF v_status <> 'available' THEN
        UPDATE book_copies SET circulation_status = 'available', updated_at = p_now WHERE id = p_copy_id;
      END IF;
      LEAVE promote;
    END IF;
    -- Hard eligibility (D4). Plain reads: readers and cards come before books in the lock order,
    -- and checkout re-checks the holder under its own locks, so a stale answer can only give a
    -- hold that later expires, never a loan.
    SET v_reader_status = NULL;
    SELECT status INTO v_reader_status FROM readers WHERE id = v_reader;
    SELECT COUNT(*) INTO v_cards FROM library_cards
     WHERE reader_id = v_reader AND status = 'active' AND expires_at > p_now;
    IF v_reader_status = 'active' AND v_cards > 0 THEN
      IF v_status <> 'on_hold' THEN
        UPDATE book_copies SET circulation_status = 'on_hold', updated_at = p_now WHERE id = p_copy_id;
      END IF;
      UPDATE reservations
         SET status = 'ready', assigned_copy_id = p_copy_id, ready_at = p_now,
             hold_expires_at = p_now + INTERVAL 3 DAY
       WHERE id = v_res;
      LEAVE promote;
    END IF;
    UPDATE reservations
       SET status = 'cancelled', close_reason = 'ineligible_at_promotion', closed_by_kind = 'system',
           closed_at = p_now
     WHERE id = v_res;
  END LOOP;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_register_copy`;
--> statement-breakpoint
CREATE PROCEDURE `sp_register_copy`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_book_id BIGINT,
  IN p_barcode VARCHAR(32),
  IN p_shelf_code VARCHAR(50),
  IN p_acquired_at DATE,
  IN p_condition VARCHAR(16),
  OUT p_copy_id BIGINT)
SQL SECURITY DEFINER
COMMENT 'Register a physical copy: available, or in_repair when damaged (FR-006)'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'catalog.write') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: catalog.write required';
  END IF;
  IF p_condition IS NULL OR p_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: condition must be good, worn or damaged';
  END IF;
  IF p_barcode IS NULL OR TRIM(p_barcode) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: barcode is required';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_book FROM books WHERE id = p_book_id FOR UPDATE;
  IF v_book IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: book';
  END IF;

  INSERT INTO book_copies
    (book_id, barcode, shelf_code, acquired_at, physical_condition, circulation_status, created_at, updated_at)
  VALUES
    (p_book_id, p_barcode, p_shelf_code, p_acquired_at, p_condition,
     IF(p_condition = 'damaged', 'in_repair', 'available'), p_now, p_now);
  SET p_copy_id = LAST_INSERT_ID();
  -- [Ext] A new lendable copy goes to the book's queue first (FR-014b).
  IF p_condition <> 'damaged' THEN
    CALL sp__promote_queue(p_copy_id, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_change_copy_status`;
--> statement-breakpoint
CREATE PROCEDURE `sp_change_copy_status`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_copy_id BIGINT,
  IN p_target_status VARCHAR(16),
  IN p_condition VARCHAR(16))
SQL SECURITY DEFINER
COMMENT 'Librarian copy maintenance: repair, repair done, found, retire (FR-006a)'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_condition VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'catalog.write') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: catalog.write required';
  END IF;
  -- on_loan, on_hold and lost are set only by the circulation procedures.
  IF p_target_status IS NULL OR p_target_status NOT IN ('available', 'in_repair', 'retired') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: target ', COALESCE(p_target_status, 'NULL'), ' is not a maintenance status');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  IF p_condition IS NOT NULL AND p_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: condition must be good, worn or damaged';
  END IF;

  START TRANSACTION;
  -- The book id only decides what to lock first (global order book → copy); it never changes.
  SELECT book_id INTO v_book FROM book_copies WHERE id = p_copy_id;
  IF v_book IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: copy';
  END IF;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT circulation_status, physical_condition INTO v_status, v_condition FROM book_copies WHERE id = p_copy_id FOR UPDATE;
  IF v_status IN ('on_loan', 'on_hold') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: copy is ', v_status, '; use the circulation procedures');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  -- A damaged copy is never lendable (FR-006a): the condition must be updated in the same call.
  IF p_target_status = 'available' AND COALESCE(p_condition, v_condition) = 'damaged' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a damaged copy cannot be made available; update its condition';
  END IF;

  -- One statement, so the CHECK and the lifecycle trigger see the final row.
  UPDATE book_copies
     SET physical_condition = COALESCE(p_condition, physical_condition),
         circulation_status = p_target_status,
         updated_at = p_now
   WHERE id = p_copy_id;
  -- [Ext] Repair done or found: the book's queue gets the copy first (FR-006a, FR-014b).
  IF p_target_status = 'available' THEN
    CALL sp__promote_queue(p_copy_id, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `sp_return_item`;
--> statement-breakpoint
CREATE PROCEDURE `sp_return_item`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  IN p_return_condition VARCHAR(16),
  IN p_damaged_fine_vnd BIGINT,
  IN p_reason VARCHAR(500))
SQL SECURITY DEFINER
COMMENT 'Receive a returned copy, assess fines, release the copy; returns the assessed fines'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_loan BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.return') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.return required';
  END IF;
  IF p_return_condition IS NULL OR p_return_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: return condition must be good, worn or damaged';
  END IF;

  START TRANSACTION;
  -- Immutable ids that decide the lock order.
  SELECT l.reader_id, c.book_id, li.copy_id, li.loan_id INTO v_reader, v_book, v_copy, v_loan
    FROM loan_items li JOIN loans l ON l.id = li.loan_id JOIN book_copies c ON c.id = li.copy_id
   WHERE li.id = p_loan_item_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: loan item';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
  SELECT id INTO v_locked FROM loans WHERE id = v_loan FOR UPDATE;
  SELECT status INTO v_status FROM loan_items WHERE id = p_loan_item_id FOR UPDATE;
  IF v_status <> 'on_loan' THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: loan item is ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  UPDATE loan_items
     SET status = 'returned', returned_at = p_now, return_condition = p_return_condition
   WHERE id = p_loan_item_id;
  CALL sp__assess_fines(p_loan_item_id, p_actor_user_id, p_now,
                        IF(p_return_condition = 'damaged', 'returned_damaged', 'returned'),
                        p_damaged_fine_vnd, NULL, p_reason);
  IF p_return_condition = 'damaged' THEN
    UPDATE book_copies SET physical_condition = 'damaged', circulation_status = 'in_repair', updated_at = p_now
     WHERE id = v_copy;
  ELSE
    UPDATE book_copies SET physical_condition = p_return_condition, circulation_status = 'available', updated_at = p_now
     WHERE id = v_copy;
    -- [Ext] The book's waiting reservations are locked last (global order) and get the copy first.
    CALL sp__promote_queue(v_copy, p_actor_user_id, p_now);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loan_items WHERE loan_id = v_loan AND status = 'on_loan') THEN
    UPDATE loans SET status = 'closed' WHERE id = v_loan;
  END IF;
  COMMIT;

  SELECT id AS fine_id, fine_type, assessed_amount_vnd FROM fines
   WHERE loan_item_id = p_loan_item_id ORDER BY id;
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

  -- 6b. [Ext] Held copies (lock order: … policy → reservation). A hold whose expiry has passed is
  --     expired here and the queue promoted (FR-014c "on demand when scanned"); the copy may then
  --     be free, or held for the next reader. Only the holder may borrow a held copy (R-14f).
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
    IF v_res IS NOT NULL THEN
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
