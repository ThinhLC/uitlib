-- Record a payment, 100% allocated (tasks T062; contracts/db-routines.md "sp_record_payment steps";
-- spec FR-016, FR-016a…c, R-16b…e). The only write path for payments and allocations: the app
-- account has no INSERT privilege on either table (R-26). MySQL has no deferred constraints, so the
-- equality Σ allocations = amount is re-checked here before COMMIT.

CREATE PROCEDURE `sp_record_payment`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_amount_vnd BIGINT,
  IN p_method VARCHAR(16),
  IN p_reference_no VARCHAR(64),
  IN p_request_key VARCHAR(64),
  IN p_allocations JSON,
  OUT p_payment_id BIGINT,
  OUT p_replayed BOOLEAN)
SQL SECURITY DEFINER
COMMENT 'Record a payment fully allocated to the reader''s fines; idempotent by request key'
BEGIN
  DECLARE v_n INT DEFAULT 0;
  DECLARE v_distinct INT DEFAULT 0;
  DECLARE v_nonpositive INT DEFAULT 0;
  DECLARE v_sum BIGINT DEFAULT 0;
  DECLARE v_locked BIGINT;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_fine BIGINT;
  DECLARE v_amount BIGINT;
  DECLARE v_owner BIGINT;
  DECLARE v_assessed BIGINT;
  DECLARE v_adjusted BIGINT;
  DECLARE v_allocated BIGINT;
  DECLARE v_outstanding BIGINT;
  DECLARE v_resum BIGINT;
  DECLARE v_existing BIGINT;
  -- A concurrent call with the same request key committed first: return that payment.
  DECLARE EXIT HANDLER FOR 1062
  BEGIN
    ROLLBACK;
    SELECT id INTO p_payment_id FROM fine_payments WHERE request_key = p_request_key;
    IF p_payment_id IS NULL THEN
      RESIGNAL;
    END IF;
    SET p_replayed = TRUE;
    DROP TEMPORARY TABLE IF EXISTS tmp_allocations;
  END;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_allocations;
    RESIGNAL;
  END;

  SET p_payment_id = NULL, p_replayed = FALSE;
  IF NOT fn_has_permission(p_actor_user_id, 'fine.collect') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: fine.collect required';
  END IF;
  IF p_request_key IS NULL OR TRIM(p_request_key) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: request_key is required';
  END IF;

  -- 1. Replay: the same request key returns the existing payment, with no writes (R-16e).
  SELECT id INTO v_existing FROM fine_payments WHERE request_key = p_request_key;
  IF v_existing IS NOT NULL THEN
    SET p_payment_id = v_existing, p_replayed = TRUE;
  ELSE
    IF p_amount_vnd IS NULL OR p_amount_vnd <= 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: amount must be positive';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'bank_transfer') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: method must be cash or bank_transfer';
    END IF;
    -- 3. Expand and validate the allocation list.
    IF p_allocations IS NULL OR JSON_TYPE(p_allocations) <> 'ARRAY' OR JSON_LENGTH(p_allocations) = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: allocations must be a non-empty JSON array';
    END IF;
    DROP TEMPORARY TABLE IF EXISTS tmp_allocations;
    CREATE TEMPORARY TABLE tmp_allocations (fine_id BIGINT NOT NULL, amount_vnd BIGINT NULL);
    INSERT INTO tmp_allocations (fine_id, amount_vnd)
    SELECT j.fine_id, j.amount_vnd
      FROM JSON_TABLE(p_allocations, '$[*]' COLUMNS (
             fine_id BIGINT PATH '$.fine_id' ERROR ON EMPTY,
             amount_vnd BIGINT PATH '$.amount_vnd' ERROR ON EMPTY)) AS j;
    SELECT COUNT(*), COUNT(DISTINCT fine_id), SUM(amount_vnd IS NULL OR amount_vnd <= 0), COALESCE(SUM(amount_vnd), 0)
      INTO v_n, v_distinct, v_nonpositive, v_sum FROM tmp_allocations;
    IF v_n <> v_distinct THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: a fine appears twice in the allocations';
    END IF;
    IF v_nonpositive > 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: every allocation must be positive';
    END IF;

    START TRANSACTION;
    -- 2. Lock the reader (first read after START TRANSACTION, and a locking one).
    SELECT id INTO v_locked FROM readers WHERE id = p_reader_id FOR UPDATE;
    IF v_locked IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
    END IF;

    -- The payment may not exceed the reader's outstanding debt (locking reads, research R5).
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
    SET v_outstanding = v_assessed + v_adjusted - v_allocated;
    IF p_amount_vnd > v_outstanding THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_EXCEEDS_DEBT: payment is larger than the outstanding debt';
    END IF;

    -- 4–5. Lock each listed fine in ascending id; it must belong to this reader and have enough left.
    SET v_i = 0;
    WHILE v_i < v_n DO
      SELECT fine_id, amount_vnd INTO v_fine, v_amount FROM tmp_allocations ORDER BY fine_id LIMIT v_i, 1;
      SET v_owner = NULL;
      SELECT l.reader_id, f.assessed_amount_vnd INTO v_owner, v_assessed
        FROM fines f JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
       WHERE f.id = v_fine FOR UPDATE OF f;
      IF v_owner IS NULL OR v_owner <> p_reader_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: a fine is missing or belongs to another reader';
      END IF;
      SELECT COALESCE(SUM(amount_vnd), 0) INTO v_adjusted FROM fine_adjustments WHERE fine_id = v_fine FOR SHARE;
      SELECT COALESCE(SUM(amount_vnd), 0) INTO v_allocated FROM fine_payment_allocations WHERE fine_id = v_fine FOR SHARE;
      IF v_amount > v_assessed + v_adjusted - v_allocated THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: an allocation exceeds the fine''s remaining balance';
      END IF;
      SET v_i = v_i + 1;
    END WHILE;
    IF v_sum <> p_amount_vnd THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: allocations must add up to the payment amount';
    END IF;

    -- 6. Write the payment, then every allocation.
    INSERT INTO fine_payments
      (reader_id, received_by_user_id, amount_vnd, paid_at, method, reference_no, request_key, created_at)
    VALUES
      (p_reader_id, p_actor_user_id, p_amount_vnd, p_now, p_method, p_reference_no, p_request_key, p_now);
    SET p_payment_id = LAST_INSERT_ID();
    INSERT INTO fine_payment_allocations (payment_id, fine_id, amount_vnd)
    SELECT p_payment_id, fine_id, amount_vnd FROM tmp_allocations ORDER BY fine_id;

    -- 7. Re-sum from the table before COMMIT (R-16b).
    SELECT COALESCE(SUM(amount_vnd), 0) INTO v_resum FROM fine_payment_allocations WHERE payment_id = p_payment_id;
    IF v_resum <> p_amount_vnd THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: stored allocations do not add up to the payment';
    END IF;
    COMMIT;
    DROP TEMPORARY TABLE IF EXISTS tmp_allocations;
  END IF;
END;
