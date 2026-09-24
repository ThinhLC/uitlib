-- Fine guards (tasks T052; spec FR-015, FR-017a, R-15b, R-17b).

CREATE TRIGGER `trg_fines_bi` BEFORE INSERT ON `fines`
FOR EACH ROW
BEGIN
  IF NEW.fine_type IN ('damaged', 'lost') AND EXISTS (
       SELECT 1 FROM fines
        WHERE loan_item_id = NEW.loan_item_id
          AND fine_type = IF(NEW.fine_type = 'damaged', 'lost', 'damaged')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a loan item cannot have both a damaged and a lost fine';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_fines_bu` BEFORE UPDATE ON `fines`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: fines cannot be updated; record an adjustment';
--> statement-breakpoint
CREATE TRIGGER `trg_fines_bd` BEFORE DELETE ON `fines`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: fines cannot be deleted';
