-- Policy version operations (tasks T042; contracts/db-routines.md; spec FR-009…FR-009c).
-- Lock order: reader type → policy versions of the pair (spec Concurrency Protocol).

CREATE PROCEDURE `sp_create_policy_version`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_type_id BIGINT,
  IN p_material_type_id BIGINT,
  IN p_max_active_items SMALLINT,
  IN p_loan_days SMALLINT,
  IN p_max_renewals SMALLINT,
  IN p_daily_late_fee_vnd BIGINT,
  IN p_debt_block_threshold_vnd BIGINT,
  IN p_valid_from DATETIME(3),
  OUT p_policy_id BIGINT)
SQL SECURITY DEFINER
COMMENT 'Create an open-ended policy version for a (reader type, material type) pair (FR-009)'
BEGIN
  DECLARE v_locked BIGINT;
  DECLARE v_material BIGINT;
  DECLARE v_overlaps INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'policy.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: policy.manage required';
  END IF;
  IF p_valid_from IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: valid_from is required';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM reader_types WHERE id = p_reader_type_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader type';
  END IF;
  SELECT id INTO v_material FROM material_types WHERE id = p_material_type_id FOR SHARE;
  IF v_material IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: material type';
  END IF;

  -- The new version is open-ended [valid_from, ∞): it overlaps any version still in effect after valid_from.
  SELECT COUNT(*) INTO v_overlaps
    FROM loan_policies
   WHERE reader_type_id = p_reader_type_id
     AND material_type_id = p_material_type_id
     AND (valid_to IS NULL OR valid_to > p_valid_from)
     FOR UPDATE;
  IF v_overlaps > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_OVERLAP: close the current version first';
  END IF;

  INSERT INTO loan_policies
    (reader_type_id, material_type_id, max_active_items, loan_days, max_renewals, daily_late_fee_vnd,
     debt_block_threshold_vnd, valid_from, valid_to, created_by_user_id, created_at)
  VALUES
    (p_reader_type_id, p_material_type_id, p_max_active_items, p_loan_days, p_max_renewals, p_daily_late_fee_vnd,
     p_debt_block_threshold_vnd, p_valid_from, NULL, p_actor_user_id, p_now);
  SET p_policy_id = LAST_INSERT_ID();
  COMMIT;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_close_policy_version`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_policy_id BIGINT,
  IN p_valid_to DATETIME(3))
SQL SECURITY DEFINER
COMMENT 'Close a policy version: not retroactive, only earlier, after every referencing borrow (FR-009c)'
BEGIN
  DECLARE v_reader_type BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_from DATETIME(3);
  DECLARE v_to DATETIME(3);
  DECLARE v_last_borrow DATETIME(3);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'policy.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: policy.manage required';
  END IF;
  IF p_valid_to IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to is required';
  END IF;

  START TRANSACTION;
  -- The reader type only decides the first lock (global order reader type → version); it never changes.
  SELECT reader_type_id INTO v_reader_type FROM loan_policies WHERE id = p_policy_id;
  IF v_reader_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: policy version';
  END IF;
  SELECT id INTO v_locked FROM reader_types WHERE id = v_reader_type FOR UPDATE;
  SELECT valid_from, valid_to INTO v_from, v_to FROM loan_policies WHERE id = p_policy_id FOR UPDATE;

  IF p_valid_to < p_now THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: retroactive close';
  END IF;
  IF p_valid_to <= v_from THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to must be after valid_from';
  END IF;
  IF v_to IS NOT NULL AND p_valid_to >= v_to THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to may only move earlier';
  END IF;
  -- Locking read (research R5): a concurrent checkout under this version serializes with us.
  SELECT MAX(borrowed_at) INTO v_last_borrow FROM loan_items WHERE policy_id = p_policy_id FOR SHARE;
  IF v_last_borrow IS NOT NULL AND p_valid_to <= v_last_borrow THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: a loan was borrowed under this version at or after valid_to';
  END IF;

  UPDATE loan_policies SET valid_to = p_valid_to WHERE id = p_policy_id;
  COMMIT;
END;
