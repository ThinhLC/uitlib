-- [Ext] Reserve, cancel and hold expiry (tasks T096; spec FR-014a, FR-014c, D6).
-- Lock order: reader → book → copy → reservations. Every writer of a book's reservations holds
-- the book lock first, so reading a reservation FOR UPDATE right after the book is safe.
-- sp_renew already rejects renewals while the book has a waiting reservation (us3_renew).

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
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  -- Staff with reservation.manage, or the reader's own active account.
  IF NOT fn_has_permission(p_actor_user_id, 'reservation.manage')
     AND NOT EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
                      WHERE r.id = p_reader_id AND u.id = p_actor_user_id AND u.status = 'active') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required, or reserve for yourself';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
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
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reservation';
  END IF;
  IF fn_has_permission(p_actor_user_id, 'reservation.manage') THEN
    SET v_kind = 'staff';
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: staff cancellation needs a reason';
    END IF;
  ELSEIF EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
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
--> statement-breakpoint
CREATE PROCEDURE `sp__expire_holds_batch`(
  IN p_now DATETIME(3),
  OUT p_count INT)
SQL SECURITY DEFINER
COMMENT 'Internal [Ext]: expire every ready hold past its expiry, one transaction per hold (cursor)'
BEGIN
  DECLARE v_done BOOLEAN DEFAULT FALSE;
  DECLARE v_res BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_until DATETIME(3);
  DECLARE c_holds CURSOR FOR
    SELECT id, book_id, assigned_copy_id FROM reservations
     WHERE status = 'ready' AND hold_expires_at <= p_now
     ORDER BY book_id, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET p_count = 0;
  OPEN c_holds;
  expire: LOOP
    FETCH c_holds INTO v_res, v_book, v_copy;
    IF v_done THEN
      LEAVE expire;
    END IF;
    START TRANSACTION;
    SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
    SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
    -- Re-check under the locks: a checkout or cancel may have closed it since the cursor read it.
    SELECT status, hold_expires_at INTO v_status, v_until FROM reservations WHERE id = v_res FOR UPDATE;
    IF v_status = 'ready' AND v_until <= p_now THEN
      UPDATE reservations
         SET status = 'expired', closed_at = p_now, closed_by_kind = 'system', close_reason = 'hold_expired'
       WHERE id = v_res;
      CALL sp__promote_queue(v_copy, NULL, p_now);
      SET p_count = p_count + 1;
    END IF;
    COMMIT;
    SET v_done = FALSE;
  END LOOP;
  CLOSE c_holds;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_expire_holds`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  OUT p_count INT)
SQL SECURITY DEFINER
COMMENT '[Ext] Expire overdue holds on demand; the event ev_expire_holds runs the same batch'
BEGIN
  IF NOT fn_has_permission(p_actor_user_id, 'reservation.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required';
  END IF;
  CALL sp__expire_holds_batch(p_now, p_count);
END;
