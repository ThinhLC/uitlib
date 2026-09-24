-- Copy operations (tasks T036; contracts/db-routines.md; spec FR-006, FR-006a, FR-026).
-- Every operation procedure: permission check, own transaction, locks in the global order
-- (book → copy), full rollback + RESIGNAL on any error.

CREATE PROCEDURE `sp_register_copy`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_book_id BIGINT,
  IN p_barcode VARCHAR(32),
  IN p_shelf_code VARCHAR(50),
  IN p_acquired_at DATE,
  IN p_condition VARCHAR(16),
  OUT p_copy_id BIGINT)
SQL SECURITY DEFINER
COMMENT 'Register a physical copy: available, or in_repair when damaged (FR-006)'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'catalog.write') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: catalog.write required';
  END IF;
  IF p_condition IS NULL OR p_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: condition must be good, worn or damaged';
  END IF;
  IF p_barcode IS NULL OR TRIM(p_barcode) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: barcode is required';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_book FROM books WHERE id = p_book_id FOR UPDATE;
  IF v_book IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: book';
  END IF;

  INSERT INTO book_copies
    (book_id, barcode, shelf_code, acquired_at, physical_condition, circulation_status, created_at, updated_at)
  VALUES
    (p_book_id, p_barcode, p_shelf_code, p_acquired_at, p_condition,
     IF(p_condition = 'damaged', 'in_repair', 'available'), p_now, p_now);
  SET p_copy_id = LAST_INSERT_ID();
  -- [Ext] extension point: CALL sp__promote_queue(p_copy_id, p_actor_user_id, p_now);
  COMMIT;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_change_copy_status`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_copy_id BIGINT,
  IN p_target_status VARCHAR(16),
  IN p_condition VARCHAR(16))
SQL SECURITY DEFINER
COMMENT 'Librarian copy maintenance: repair, repair done, found, retire (FR-006a)'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'catalog.write') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: catalog.write required';
  END IF;
  -- on_loan, on_hold and lost are set only by the circulation procedures.
  IF p_target_status IS NULL OR p_target_status NOT IN ('available', 'in_repair', 'retired') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: target ', COALESCE(p_target_status, 'NULL'), ' is not a maintenance status');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  IF p_condition IS NOT NULL AND p_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: condition must be good, worn or damaged';
  END IF;

  START TRANSACTION;
  -- The book id only decides what to lock first (global order book → copy); it never changes.
  SELECT book_id INTO v_book FROM book_copies WHERE id = p_copy_id;
  IF v_book IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: copy';
  END IF;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT circulation_status INTO v_status FROM book_copies WHERE id = p_copy_id FOR UPDATE;
  IF v_status IN ('on_loan', 'on_hold') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: copy is ', v_status, '; use the circulation procedures');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  -- One statement, so the CHECK and the lifecycle trigger see the final row.
  UPDATE book_copies
     SET physical_condition = COALESCE(p_condition, physical_condition),
         circulation_status = p_target_status,
         updated_at = p_now
   WHERE id = p_copy_id;
  -- [Ext] extension point: when p_target_status = 'available', CALL sp__promote_queue(p_copy_id, …);
  COMMIT;
END;
