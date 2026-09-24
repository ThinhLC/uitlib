-- Library card operations and the card-expiry cursor (tasks T043; spec FR-008, FR-028).
-- Lock order: reader → reader's cards.

CREATE PROCEDURE `sp_issue_card`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_card_number VARCHAR(32),
  IN p_expires_at DATETIME(3),
  OUT p_card_id BIGINT)
SQL SECURITY DEFINER
COMMENT 'Issue an active card; at most one active card per reader (R-08c)'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_cards INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'card.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: card.manage required';
  END IF;
  IF p_card_number IS NULL OR TRIM(p_card_number) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: card number is required';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= p_now THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: expiry must be after the issue time';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_reader FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
  END IF;
  SELECT COUNT(*) INTO v_cards FROM library_cards WHERE reader_id = p_reader_id FOR UPDATE;
  -- A second active card fails on UNIQUE(active_reader_id) with errno 1062 (R-08c).
  INSERT INTO library_cards (reader_id, card_number, issued_at, expires_at, status, created_at)
  VALUES (p_reader_id, p_card_number, p_now, p_expires_at, 'active', p_now);
  SET p_card_id = LAST_INSERT_ID();
  COMMIT;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_set_card_status`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_card_id BIGINT,
  IN p_status VARCHAR(16))
SQL SECURITY DEFINER
COMMENT 'Move a card from active to expired, lost or revoked (FR-008)'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'card.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: card.manage required';
  END IF;

  START TRANSACTION;
  -- The reader only decides the first lock (reader → card); a card's reader never changes.
  SELECT reader_id INTO v_reader FROM library_cards WHERE id = p_card_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: card';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT status INTO v_status FROM library_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT (v_status = 'active' AND p_status IN ('expired', 'lost', 'revoked')) THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: card ', v_status, ' -> ', COALESCE(p_status, 'NULL'));
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  UPDATE library_cards SET status = p_status WHERE id = p_card_id;
  COMMIT;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_expire_cards`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  OUT p_count INT)
SQL SECURITY DEFINER
COMMENT 'Cursor batch: expire every active card whose expiry has passed, one transaction per card (FR-028)'
BEGIN
  DECLARE v_card BIGINT;
  DECLARE v_reader BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_still INT;
  DECLARE v_done BOOLEAN DEFAULT FALSE;
  DECLARE cur CURSOR FOR
    SELECT id, reader_id FROM library_cards
     WHERE status = 'active' AND expires_at <= p_now
     ORDER BY reader_id, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'card.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: card.manage required';
  END IF;

  SET p_count = 0;
  OPEN cur;
  card_loop: LOOP
    FETCH cur INTO v_card, v_reader;
    IF v_done THEN
      LEAVE card_loop;
    END IF;
    START TRANSACTION;
    SELECT COUNT(*) INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
    -- Re-check under the lock: the card may have changed since the cursor read it.
    SELECT COUNT(*) INTO v_still FROM library_cards
     WHERE id = v_card AND status = 'active' AND expires_at <= p_now FOR UPDATE;
    IF v_still = 1 THEN
      UPDATE library_cards SET status = 'expired' WHERE id = v_card;
      SET p_count = p_count + 1;
    END IF;
    COMMIT;
  END LOOP;
  CLOSE cur;
END;
