-- Return, lost declaration and fine assessment (tasks T054; spec FR-010, FR-011a, FR-015…FR-015b).
-- Lock order: reader → book → copy → loan → loan item (→ fines written).

-- Internal helper: runs inside the caller's transaction; never granted to the app account.
CREATE PROCEDURE `sp__assess_fines`(
  IN p_loan_item_id BIGINT,
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_end_kind VARCHAR(20),          -- 'returned' | 'returned_damaged' | 'lost'
  IN p_damaged_vnd BIGINT,
  IN p_lost_vnd BIGINT,
  IN p_reason VARCHAR(500))
SQL SECURITY DEFINER
COMMENT 'Internal: assess late / damaged / lost fines for one loan item (FR-015a/b)'
BEGIN
  DECLARE v_due DATETIME(3);
  DECLARE v_fee BIGINT;
  DECLARE v_cost BIGINT;
  DECLARE v_days INT;
  DECLARE v_late BIGINT;
  DECLARE v_lost BIGINT;
  DECLARE v_blank BOOLEAN;

  SELECT li.due_at, li.applied_daily_fee_vnd, b.replacement_cost_vnd INTO v_due, v_fee, v_cost
    FROM loan_items li
    JOIN book_copies c ON c.id = li.copy_id
    JOIN books b ON b.id = c.book_id
   WHERE li.id = p_loan_item_id;
  SET v_blank = (p_reason IS NULL OR CHAR_LENGTH(TRIM(p_reason)) = 0);

  -- Late fine: whole local days to the end event (return or lost declaration), capped (D2).
  SET v_days = fn_days_late(v_due, p_now);
  IF v_days > 0 THEN
    SET v_late = fn_late_fee(v_days, v_fee, v_cost);
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'late', v_late, v_late, NULL, p_now, p_actor_user_id);
  END IF;

  -- Damaged fine: librarian-entered, 0…replacement cost, reason required (D3).
  IF p_end_kind = 'returned_damaged' THEN
    IF p_damaged_vnd IS NULL OR p_damaged_vnd < 0 OR (v_cost IS NOT NULL AND p_damaged_vnd > v_cost) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: damaged fine must be between 0 and the replacement cost';
    END IF;
    IF v_blank THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a damaged fine needs a reason';
    END IF;
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'damaged', 0, p_damaged_vnd, p_reason, p_now, p_actor_user_id);
  END IF;

  -- Lost fine: default = replacement cost; an override or an unknown cost needs a reason.
  IF p_end_kind = 'lost' THEN
    IF v_cost IS NULL AND (p_lost_vnd IS NULL OR v_blank) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: replacement cost unknown; enter a lost fine and a reason';
    END IF;
    IF p_lost_vnd IS NOT NULL AND p_lost_vnd < 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: lost fine cannot be negative';
    END IF;
    SET v_lost = COALESCE(p_lost_vnd, v_cost);
    IF v_lost <> COALESCE(v_cost, -1) AND v_blank THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a lost fine different from the replacement cost needs a reason';
    END IF;
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'lost', COALESCE(v_cost, 0), v_lost, IF(v_blank, NULL, p_reason), p_now, p_actor_user_id);
  END IF;
END;
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
    -- [Ext] extension point: CALL sp__promote_queue(v_copy, p_actor_user_id, p_now);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loan_items WHERE loan_id = v_loan AND status = 'on_loan') THEN
    UPDATE loans SET status = 'closed' WHERE id = v_loan;
  END IF;
  COMMIT;

  SELECT id AS fine_id, fine_type, assessed_amount_vnd FROM fines
   WHERE loan_item_id = p_loan_item_id ORDER BY id;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_declare_lost`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  IN p_lost_fine_vnd BIGINT,
  IN p_reason VARCHAR(500))
SQL SECURITY DEFINER
COMMENT 'Declare a loaned copy lost: late fine to now plus lost fine; returns the assessed fines'
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

  START TRANSACTION;
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

  UPDATE loan_items SET status = 'lost', lost_declared_at = p_now WHERE id = p_loan_item_id;
  CALL sp__assess_fines(p_loan_item_id, p_actor_user_id, p_now, 'lost', NULL, p_lost_fine_vnd, p_reason);
  UPDATE book_copies SET circulation_status = 'lost', updated_at = p_now WHERE id = v_copy;
  IF NOT EXISTS (SELECT 1 FROM loan_items WHERE loan_id = v_loan AND status = 'on_loan') THEN
    UPDATE loans SET status = 'closed' WHERE id = v_loan;
  END IF;
  COMMIT;

  SELECT id AS fine_id, fine_type, assessed_amount_vnd FROM fines
   WHERE loan_item_id = p_loan_item_id ORDER BY id;
END;
