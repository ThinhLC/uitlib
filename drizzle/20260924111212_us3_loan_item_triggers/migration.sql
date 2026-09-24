-- Loan item guards (tasks T051; spec FR-011, FR-011a, R-11a, R-11c, R-12c).
-- Snapshot reads only: these are bypass guards, not concurrency control.

CREATE TRIGGER `trg_loan_items_bi` BEFORE INSERT ON `loan_items`
FOR EACH ROW
BEGIN
  DECLARE v_copy_status VARCHAR(16);
  IF NEW.status <> 'on_loan' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a loan item starts on_loan';
  END IF;
  SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = NEW.copy_id;
  IF v_copy_status IS NULL OR v_copy_status NOT IN ('available', 'on_hold') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy is not available for a new loan item';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_loan_items_bu` BEFORE UPDATE ON `loan_items`
FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(128);
  -- R-11a: identity and the applied-policy snapshot never change.
  IF NOT (NEW.loan_id <=> OLD.loan_id
      AND NEW.copy_id <=> OLD.copy_id
      AND NEW.policy_id <=> OLD.policy_id
      AND NEW.borrowed_at <=> OLD.borrowed_at
      AND NEW.applied_loan_days <=> OLD.applied_loan_days
      AND NEW.applied_max_renewals <=> OLD.applied_max_renewals
      AND NEW.applied_daily_fee_vnd <=> OLD.applied_daily_fee_vnd) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNAPSHOT_IMMUTABLE: loan item identity or policy snapshot changed';
  END IF;
  -- R-11c: on_loan → returned | lost; both terminal.
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'on_loan' AND NEW.status IN ('returned', 'lost')) THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: loan item ', OLD.status, ' -> ', NEW.status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  -- The due time moves only forward, and only while the item is on loan (renewal).
  IF NOT (NEW.due_at <=> OLD.due_at) AND (OLD.status <> 'on_loan' OR NEW.due_at <= OLD.due_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNAPSHOT_IMMUTABLE: due time may only move later while on loan';
  END IF;
END;
