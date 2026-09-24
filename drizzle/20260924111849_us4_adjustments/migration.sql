-- Fine adjustments (tasks T066; contracts/db-routines.md; spec FR-017, R-17a, R-17b, D9).

-- Bypass guard for R-17a: after the adjustment, net ≥ allocated and net ≥ 0.
CREATE TRIGGER `trg_fine_adjustments_bi` BEFORE INSERT ON `fine_adjustments`
FOR EACH ROW
BEGIN
  DECLARE v_net BIGINT;
  DECLARE v_allocated BIGINT;
  SET v_net = fn_fine_net(NEW.fine_id) + NEW.amount_vnd;
  SET v_allocated = COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE fine_id = NEW.fine_id), 0);
  IF v_net < 0 OR v_net < v_allocated THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment would leave the fine below the amount already paid';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_fine_adjustments_bu` BEFORE UPDATE ON `fine_adjustments`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: adjustments cannot be updated';
--> statement-breakpoint
CREATE TRIGGER `trg_fine_adjustments_bd` BEFORE DELETE ON `fine_adjustments`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: adjustments cannot be deleted';
--> statement-breakpoint
CREATE PROCEDURE `sp_adjust_fine`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_fine_id BIGINT,
  IN p_amount_vnd BIGINT,
  IN p_reason VARCHAR(500),
  OUT p_adjustment_id BIGINT)
SQL SECURITY DEFINER
COMMENT 'Record an audited, signed correction to a fine (FR-017)'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_assessed BIGINT;
  DECLARE v_adjusted BIGINT;
  DECLARE v_allocated BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'fine.adjust') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: fine.adjust required';
  END IF;
  IF p_amount_vnd IS NULL OR p_amount_vnd = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment amount must be non-zero';
  END IF;
  IF p_reason IS NULL OR CHAR_LENGTH(TRIM(p_reason)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: an adjustment needs a reason';
  END IF;

  START TRANSACTION;
  -- The fine's reader decides the first lock (reader → fine); it never changes.
  SELECT l.reader_id INTO v_reader
    FROM fines f JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
   WHERE f.id = p_fine_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: fine';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT assessed_amount_vnd INTO v_assessed FROM fines WHERE id = p_fine_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_adjusted FROM fine_adjustments WHERE fine_id = p_fine_id FOR SHARE;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_allocated FROM fine_payment_allocations WHERE fine_id = p_fine_id FOR SHARE;
  IF v_assessed + v_adjusted + p_amount_vnd < v_allocated OR v_assessed + v_adjusted + p_amount_vnd < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment would leave the fine below the amount already paid';
  END IF;

  INSERT INTO fine_adjustments (fine_id, amount_vnd, reason, adjusted_by_user_id, adjusted_at)
  VALUES (p_fine_id, p_amount_vnd, p_reason, p_actor_user_id, p_now);
  SET p_adjustment_id = LAST_INSERT_ID();
  COMMIT;
END;
