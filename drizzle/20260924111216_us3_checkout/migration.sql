-- Checkout (tasks T053; contracts/db-routines.md; spec FR-009b, FR-009d, FR-010…FR-012, R-12b, D13).
-- Lock order: reader → reader's cards (S) → books ↑ → copies ↑ → policy versions (S) → the reader's
-- loans / items / fines (S, for eligibility). Every decision uses a locking read taken after the
-- reader lock (research R5). All-or-nothing for multi-copy checkouts.

CREATE PROCEDURE `sp_checkout`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_copy_ids JSON)
SQL SECURITY DEFINER
COMMENT 'Lend one or more copies to a reader; returns loan_id, loan_item_id, copy_id, due_at'
BEGIN
  DECLARE v_n INT DEFAULT 0;
  DECLARE v_distinct INT DEFAULT 0;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_id BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_material BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_reader_status VARCHAR(16);
  DECLARE v_reader_type BIGINT;
  DECLARE v_cards INT DEFAULT 0;
  DECLARE v_copy_status VARCHAR(16);
  DECLARE v_books INT DEFAULT 0;
  DECLARE v_types INT DEFAULT 0;
  DECLARE v_policy BIGINT;
  DECLARE v_loan_days SMALLINT;
  DECLARE v_max_renewals SMALLINT;
  DECLARE v_fee BIGINT;
  DECLARE v_threshold BIGINT;
  DECLARE v_max_items SMALLINT;
  DECLARE v_assessed BIGINT DEFAULT 0;
  DECLARE v_adjusted BIGINT DEFAULT 0;
  DECLARE v_allocated BIGINT DEFAULT 0;
  DECLARE v_overdue INT DEFAULT 0;
  DECLARE v_open INT DEFAULT 0;
  DECLARE v_requested INT DEFAULT 0;
  DECLARE v_loan BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
    RESIGNAL;
  END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.checkout') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.checkout required';
  END IF;
  IF p_copy_ids IS NULL OR JSON_TYPE(p_copy_ids) <> 'ARRAY' OR JSON_LENGTH(p_copy_ids) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: copy_ids must be a non-empty JSON array';
  END IF;
  SELECT COUNT(*), COUNT(DISTINCT j.id) INTO v_n, v_distinct
    FROM JSON_TABLE(p_copy_ids, '$[*]' COLUMNS (id BIGINT PATH '$' ERROR ON ERROR)) AS j;
  IF v_n <> v_distinct THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: copy_ids must be distinct';
  END IF;

  DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
  CREATE TEMPORARY TABLE tmp_checkout (
    copy_id BIGINT PRIMARY KEY,
    book_id BIGINT NULL,
    material_type_id BIGINT NULL,
    policy_id BIGINT NULL,
    loan_days SMALLINT NULL,
    max_renewals SMALLINT NULL,
    daily_fee BIGINT NULL,
    threshold BIGINT NULL,
    max_items SMALLINT NULL);
  INSERT INTO tmp_checkout (copy_id)
  SELECT j.id FROM JSON_TABLE(p_copy_ids, '$[*]' COLUMNS (id BIGINT PATH '$')) AS j;

  START TRANSACTION;

  -- 1. Reader (first read after START TRANSACTION, and a locking one).
  SELECT status, reader_type_id INTO v_reader_status, v_reader_type
    FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_reader_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
  END IF;
  IF v_reader_status <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'READER_NOT_ACTIVE: reader is suspended or inactive';
  END IF;

  -- 2. Card valid at the borrow time.
  SELECT COUNT(*) INTO v_cards FROM library_cards
   WHERE reader_id = p_reader_id AND status = 'active' AND expires_at > p_now FOR SHARE;
  IF v_cards = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CARD_INVALID: no active, unexpired card';
  END IF;

  -- 3. Resolve each copy's book (immutable ids; this read only decides the lock order).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SET v_book = NULL, v_material = NULL;
    SELECT c.book_id, b.material_type_id INTO v_book, v_material
      FROM book_copies c JOIN books b ON b.id = c.book_id WHERE c.id = v_id;
    IF v_book IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: copy';
    END IF;
    UPDATE tmp_checkout SET book_id = v_book, material_type_id = v_material WHERE copy_id = v_id;
    SET v_i = v_i + 1;
  END WHILE;

  -- 4. Lock the books in ascending id.
  SELECT COUNT(DISTINCT book_id) INTO v_books FROM tmp_checkout;
  SET v_i = 0;
  WHILE v_i < v_books DO
    SELECT DISTINCT book_id INTO v_id FROM tmp_checkout ORDER BY book_id LIMIT v_i, 1;
    SELECT id INTO v_locked FROM books WHERE id = v_id FOR UPDATE;
    SET v_i = v_i + 1;
  END WHILE;

  -- 5. Lock the copies in ascending id; each must be available.
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = v_id FOR UPDATE;
    -- [Ext] extension point: expire an overdue hold on this copy, then accept on_hold for this
    -- reader's ready reservation.
    IF v_copy_status <> 'available' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_NOT_AVAILABLE: a requested copy is not available';
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  -- 6. The policy version in effect at the borrow time, per material type (shared lock, R-09f).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id, material_type_id INTO v_id, v_material FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SET v_policy = NULL;
    SELECT id, loan_days, max_renewals, daily_late_fee_vnd, debt_block_threshold_vnd, max_active_items
      INTO v_policy, v_loan_days, v_max_renewals, v_fee, v_threshold, v_max_items
      FROM loan_policies
     WHERE reader_type_id = v_reader_type AND material_type_id = v_material
       AND valid_from <= p_now AND (valid_to IS NULL OR valid_to > p_now)
     FOR SHARE;
    IF v_policy IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_POLICY: no policy version covers this reader type and time';
    END IF;
    UPDATE tmp_checkout
       SET policy_id = v_policy, loan_days = v_loan_days, max_renewals = v_max_renewals,
           daily_fee = v_fee, threshold = v_threshold, max_items = v_max_items
     WHERE copy_id = v_id;
    SET v_i = v_i + 1;
  END WHILE;

  -- 7. Outstanding debt, from locking reads (not fn_reader_outstanding; research R5).
  SELECT COALESCE(SUM(f.assessed_amount_vnd), 0) INTO v_assessed
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT COALESCE(SUM(a.amount_vnd), 0) INTO v_adjusted
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
    JOIN fine_adjustments a ON a.fine_id = f.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT COALESCE(SUM(x.amount_vnd), 0) INTO v_allocated
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN fines f ON f.loan_item_id = li.id
    JOIN fine_payment_allocations x ON x.fine_id = f.id
   WHERE l.reader_id = p_reader_id FOR SHARE;
  SELECT MIN(threshold) INTO v_threshold FROM tmp_checkout;
  IF v_assessed + v_adjusted - v_allocated > v_threshold THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEBT_BLOCKED: outstanding debt is above the threshold';
  END IF;

  -- 8. No overdue item (D7).
  SELECT COUNT(*) INTO v_overdue
    FROM loans l JOIN loan_items li ON li.loan_id = l.id
   WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND li.due_at < p_now FOR SHARE;
  IF v_overdue > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OVERDUE_BLOCKED: reader has an overdue item';
  END IF;

  -- 9. Item limit per material type.
  SELECT COUNT(DISTINCT material_type_id) INTO v_types FROM tmp_checkout;
  SET v_i = 0;
  WHILE v_i < v_types DO
    SELECT DISTINCT material_type_id INTO v_material FROM tmp_checkout ORDER BY material_type_id LIMIT v_i, 1;
    SELECT COUNT(*), MAX(max_items) INTO v_requested, v_max_items FROM tmp_checkout WHERE material_type_id = v_material;
    SELECT COUNT(*) INTO v_open
      FROM loans l
      JOIN loan_items li ON li.loan_id = l.id
      JOIN book_copies c ON c.id = li.copy_id
      JOIN books b ON b.id = c.book_id
     WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND b.material_type_id = v_material
       FOR SHARE;
    IF v_open + v_requested > v_max_items THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIMIT_REACHED: too many items on loan';
    END IF;
    SET v_i = v_i + 1;
  END WHILE;

  -- 10. Write: loan, items (policy snapshot), then copies (research R4 write order).
  INSERT INTO loans (reader_id, processed_by_user_id, borrowed_at, status, created_at)
  VALUES (p_reader_id, p_actor_user_id, p_now, 'open', p_now);
  SET v_loan = LAST_INSERT_ID();
  INSERT INTO loan_items
    (loan_id, copy_id, policy_id, borrowed_at, due_at, status, renewal_count,
     applied_loan_days, applied_max_renewals, applied_daily_fee_vnd)
  SELECT v_loan, copy_id, policy_id, p_now, fn_due_at(p_now, loan_days), 'on_loan', 0,
         loan_days, max_renewals, daily_fee
    FROM tmp_checkout ORDER BY copy_id;
  UPDATE book_copies c JOIN tmp_checkout t ON t.copy_id = c.id
     SET c.circulation_status = 'on_loan', c.updated_at = p_now;
  COMMIT;

  DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
  SELECT loan_id, id AS loan_item_id, copy_id, due_at FROM loan_items WHERE loan_id = v_loan ORDER BY id;
END;
