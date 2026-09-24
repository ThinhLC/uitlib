-- Policy version guards (tasks T041; spec FR-009, FR-009a, R-09a, R-09c).

-- Bypass guard for R-09a: a version may not overlap another version of the same pair.
-- (sp_create_policy_version serializes creators by locking the reader_types row.)
CREATE TRIGGER `trg_loan_policies_bi` BEFORE INSERT ON `loan_policies`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM loan_policies p
     WHERE p.reader_type_id = NEW.reader_type_id
       AND p.material_type_id = NEW.material_type_id
       AND p.valid_from < COALESCE(NEW.valid_to, '9999-12-31 23:59:59.999')
       AND COALESCE(p.valid_to, '9999-12-31 23:59:59.999') > NEW.valid_from) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_OVERLAP: another version of this pair overlaps';
  END IF;
END;
--> statement-breakpoint
-- R-09c: business values are immutable; valid_to may only be set (from NULL) or moved earlier.
CREATE TRIGGER `trg_loan_policies_bu` BEFORE UPDATE ON `loan_policies`
FOR EACH ROW
BEGIN
  IF NOT (NEW.reader_type_id <=> OLD.reader_type_id
      AND NEW.material_type_id <=> OLD.material_type_id
      AND NEW.max_active_items <=> OLD.max_active_items
      AND NEW.loan_days <=> OLD.loan_days
      AND NEW.max_renewals <=> OLD.max_renewals
      AND NEW.daily_late_fee_vnd <=> OLD.daily_late_fee_vnd
      AND NEW.debt_block_threshold_vnd <=> OLD.debt_block_threshold_vnd
      AND NEW.valid_from <=> OLD.valid_from
      AND NEW.created_by_user_id <=> OLD.created_by_user_id
      AND NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_IMMUTABLE: business values of a policy version cannot change';
  END IF;
  IF NOT (NEW.valid_to <=> OLD.valid_to) THEN
    IF NEW.valid_to IS NULL OR (OLD.valid_to IS NOT NULL AND NEW.valid_to >= OLD.valid_to) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_IMMUTABLE: valid_to may only be set or moved earlier';
    END IF;
  END IF;
END;
