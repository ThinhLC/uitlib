-- Copy lifecycle guard (tasks T035; spec FR-006a, R-06b, R-12c; research R4).
-- (a) only the (old, new) circulation_status pairs of the lifecycle table are allowed;
-- (b) a copy may enter on_loan only when it has an on_loan loan item;
-- (c) a copy may leave on_loan only when it has no on_loan loan item.
-- Reads here are snapshot reads: this is a bypass guard, not concurrency control (spec matrix).
CREATE TRIGGER `trg_book_copies_bu` BEFORE UPDATE ON `book_copies`
FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(128);
  IF NEW.circulation_status <> OLD.circulation_status THEN
    IF NOT (
         (OLD.circulation_status = 'available' AND NEW.circulation_status IN ('on_loan', 'on_hold', 'in_repair', 'retired'))
      OR (OLD.circulation_status = 'on_loan'   AND NEW.circulation_status IN ('available', 'on_hold', 'in_repair', 'lost'))
      OR (OLD.circulation_status = 'on_hold'   AND NEW.circulation_status IN ('available', 'on_loan'))
      OR (OLD.circulation_status = 'in_repair' AND NEW.circulation_status IN ('available', 'on_hold', 'retired'))
      OR (OLD.circulation_status = 'lost'      AND NEW.circulation_status IN ('available', 'on_hold', 'in_repair', 'retired'))
    ) THEN
      SET v_msg = CONCAT('INVALID_TRANSITION: copy ', OLD.circulation_status, ' -> ', NEW.circulation_status);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
    IF NEW.circulation_status = 'on_loan'
       AND NOT EXISTS (SELECT 1 FROM loan_items WHERE copy_id = NEW.id AND status = 'on_loan') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy enters on_loan without an open loan item';
    END IF;
    IF OLD.circulation_status = 'on_loan'
       AND EXISTS (SELECT 1 FROM loan_items WHERE copy_id = NEW.id AND status = 'on_loan') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy leaves on_loan while a loan item is open';
    END IF;
  END IF;
END;
