-- Renewal (tasks T055; spec FR-013, R-13a, D5). Lock order: reader → book → loan item.

CREATE PROCEDURE `sp_renew`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  OUT p_new_due_at DATETIME(3))
SQL SECURITY DEFINER
COMMENT 'Extend a loan item by its applied loan days; records the renewal'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_due DATETIME(3);
  DECLARE v_count SMALLINT;
  DECLARE v_max SMALLINT;
  DECLARE v_days SMALLINT;
  DECLARE v_waiting INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.renew') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.renew required';
  END IF;

  START TRANSACTION;
  SELECT l.reader_id, c.book_id INTO v_reader, v_book
    FROM loan_items li JOIN loans l ON l.id = li.loan_id JOIN book_copies c ON c.id = li.copy_id
   WHERE li.id = p_loan_item_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: loan item';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT status, due_at, renewal_count, applied_max_renewals, applied_loan_days
    INTO v_status, v_due, v_count, v_max, v_days
    FROM loan_items WHERE id = p_loan_item_id FOR UPDATE;

  IF v_status <> 'on_loan' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: not_on_loan';
  END IF;
  IF v_due < p_now THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: overdue';
  END IF;
  IF v_count >= v_max THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: limit';
  END IF;
  -- [Ext] a waiting reservation for the book blocks renewal (trivially none while reservations are not built).
  SELECT COUNT(*) INTO v_waiting FROM reservations WHERE book_id = v_book AND status = 'waiting' FOR SHARE;
  IF v_waiting > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: reserved';
  END IF;

  SET p_new_due_at = v_due + INTERVAL v_days DAY;
  UPDATE loan_items SET due_at = p_new_due_at, renewal_count = renewal_count + 1 WHERE id = p_loan_item_id;
  INSERT INTO loan_renewals (loan_item_id, old_due_at, new_due_at, renewed_at, performed_by_user_id)
  VALUES (p_loan_item_id, v_due, p_new_due_at, p_now, p_actor_user_id);
  COMMIT;
END;
