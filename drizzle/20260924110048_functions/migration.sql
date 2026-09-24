-- Stored functions (tasks T026, contracts/db-routines.md "Functions", spec FR-027).
-- Library local time is Asia/Ho_Chi_Minh, a fixed UTC+07:00 (no DST).

CREATE FUNCTION `fn_local_date`(p_ts DATETIME(3))
RETURNS DATE
DETERMINISTIC
SQL SECURITY DEFINER
COMMENT 'Library-local calendar date of a UTC instant'
RETURN DATE(p_ts + INTERVAL 7 HOUR);
--> statement-breakpoint
CREATE FUNCTION `fn_due_at`(p_borrowed_at DATETIME(3), p_loan_days INT)
RETURNS DATETIME(3)
DETERMINISTIC
SQL SECURITY DEFINER
COMMENT 'UTC instant of 23:59:59.999 local time, loan_days after the local borrow date (FR-011)'
RETURN TIMESTAMP(fn_local_date(p_borrowed_at) + INTERVAL p_loan_days DAY, '23:59:59.999') - INTERVAL 7 HOUR;
--> statement-breakpoint
CREATE FUNCTION `fn_days_late`(p_due_at DATETIME(3), p_end_at DATETIME(3))
RETURNS INT
DETERMINISTIC
SQL SECURITY DEFINER
COMMENT 'Whole local calendar days between the due date and the end event, minimum 0 (FR-015a)'
RETURN GREATEST(0, DATEDIFF(fn_local_date(p_end_at), fn_local_date(p_due_at)));
--> statement-breakpoint
CREATE FUNCTION `fn_late_fee`(p_days INT, p_daily_fee BIGINT, p_cap BIGINT)
RETURNS BIGINT
DETERMINISTIC
SQL SECURITY DEFINER
COMMENT 'days x daily fee, capped at p_cap when it is not NULL (D2)'
RETURN IF(p_cap IS NULL, p_days * p_daily_fee, LEAST(p_days * p_daily_fee, p_cap));
--> statement-breakpoint
CREATE FUNCTION `fn_fine_net`(p_fine_id BIGINT)
RETURNS BIGINT
READS SQL DATA
SQL SECURITY DEFINER
COMMENT 'Assessed amount plus all adjustments (reports only; decisions use locking reads)'
RETURN (SELECT f.assessed_amount_vnd
               + COALESCE((SELECT SUM(a.amount_vnd) FROM fine_adjustments a WHERE a.fine_id = f.id), 0)
          FROM fines f WHERE f.id = p_fine_id);
--> statement-breakpoint
CREATE FUNCTION `fn_fine_remaining`(p_fine_id BIGINT)
RETURNS BIGINT
READS SQL DATA
SQL SECURITY DEFINER
COMMENT 'Net amount minus allocations (reports only; decisions use locking reads)'
RETURN fn_fine_net(p_fine_id)
       - COALESCE((SELECT SUM(x.amount_vnd) FROM fine_payment_allocations x WHERE x.fine_id = p_fine_id), 0);
--> statement-breakpoint
CREATE FUNCTION `fn_reader_outstanding`(p_reader_id BIGINT, p_as_of DATETIME(3))
RETURNS BIGINT
READS SQL DATA
SQL SECURITY DEFINER
COMMENT 'Cumulative outstanding debt of a reader at an instant (FR-018; reports only)'
RETURN
    COALESCE((SELECT SUM(f.assessed_amount_vnd)
                FROM fines f
                JOIN loan_items li ON li.id = f.loan_item_id
                JOIN loans l ON l.id = li.loan_id
               WHERE l.reader_id = p_reader_id AND f.assessed_at <= p_as_of), 0)
  + COALESCE((SELECT SUM(a.amount_vnd)
                FROM fine_adjustments a
                JOIN fines f ON f.id = a.fine_id
                JOIN loan_items li ON li.id = f.loan_item_id
                JOIN loans l ON l.id = li.loan_id
               WHERE l.reader_id = p_reader_id AND a.adjusted_at <= p_as_of), 0)
  - COALESCE((SELECT SUM(p.amount_vnd)
                FROM fine_payments p
               WHERE p.reader_id = p_reader_id AND p.paid_at <= p_as_of), 0);
--> statement-breakpoint
CREATE FUNCTION `fn_has_permission`(p_user_id BIGINT, p_code VARCHAR(64))
RETURNS BOOLEAN
READS SQL DATA
SQL SECURITY DEFINER
COMMENT 'TRUE if the account exists, is active and one of its roles grants the permission'
RETURN EXISTS (
  SELECT 1
    FROM app_users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE u.id = p_user_id AND u.status = 'active' AND p.code = p_code);
