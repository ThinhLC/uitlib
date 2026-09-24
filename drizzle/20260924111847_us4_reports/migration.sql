-- Debt report procedures and circulation report views (tasks T063; contracts/reports-and-invariants.md;
-- spec FR-018). Every record counts at its own time: fines at assessed_at, adjustments at adjusted_at,
-- payments (and their allocations) at paid_at.

CREATE PROCEDURE `sp_report_cumulative`(IN p_as_of DATETIME(3), IN p_reader_id BIGINT)
SQL SECURITY DEFINER
READS SQL DATA
COMMENT 'Cumulative balance at an instant: net_assessed = collected + outstanding (FR-018)'
BEGIN
  SELECT rd.id AS reader_id,
         COALESCE(fa.s, 0) + COALESCE(ad.s, 0) AS net_assessed,
         COALESCE(py.s, 0) AS collected,
         COALESCE(fa.s, 0) + COALESCE(ad.s, 0) - COALESCE(py.s, 0) AS outstanding
    FROM readers rd
    LEFT JOIN (SELECT l.reader_id, SUM(f.assessed_amount_vnd) s
                 FROM fines f JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
                WHERE f.assessed_at <= p_as_of GROUP BY l.reader_id) fa ON fa.reader_id = rd.id
    LEFT JOIN (SELECT l.reader_id, SUM(a.amount_vnd) s
                 FROM fine_adjustments a JOIN fines f ON f.id = a.fine_id
                 JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
                WHERE a.adjusted_at <= p_as_of GROUP BY l.reader_id) ad ON ad.reader_id = rd.id
    LEFT JOIN (SELECT reader_id, SUM(amount_vnd) s
                 FROM fine_payments WHERE paid_at <= p_as_of GROUP BY reader_id) py ON py.reader_id = rd.id
   WHERE (p_reader_id IS NOT NULL AND rd.id = p_reader_id)
      OR (p_reader_id IS NULL AND (fa.s IS NOT NULL OR ad.s IS NOT NULL OR py.s IS NOT NULL))
   ORDER BY rd.id;
END;
--> statement-breakpoint
CREATE PROCEDURE `sp_report_rollforward`(IN p_from DATETIME(3), IN p_to DATETIME(3), IN p_reader_id BIGINT)
SQL SECURITY DEFINER
READS SQL DATA
COMMENT 'Period [from, to): closing = opening + assessed + adjusted - collected (FR-018)'
BEGIN
  SELECT rd.id AS reader_id,
         COALESCE(fa.before_from, 0) + COALESCE(ad.before_from, 0) - COALESCE(py.before_from, 0) AS opening_outstanding,
         COALESCE(fa.in_period, 0) AS assessed_in_period,
         COALESCE(ad.in_period, 0) AS adjusted_in_period,
         COALESCE(py.in_period, 0) AS collected_in_period,
         COALESCE(fa.before_to, 0) + COALESCE(ad.before_to, 0) - COALESCE(py.before_to, 0) AS closing_outstanding
    FROM readers rd
    LEFT JOIN (SELECT l.reader_id,
                      SUM(IF(f.assessed_at < p_from, f.assessed_amount_vnd, 0)) before_from,
                      SUM(IF(f.assessed_at >= p_from AND f.assessed_at < p_to, f.assessed_amount_vnd, 0)) in_period,
                      SUM(IF(f.assessed_at < p_to, f.assessed_amount_vnd, 0)) before_to
                 FROM fines f JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
                GROUP BY l.reader_id) fa ON fa.reader_id = rd.id
    LEFT JOIN (SELECT l.reader_id,
                      SUM(IF(a.adjusted_at < p_from, a.amount_vnd, 0)) before_from,
                      SUM(IF(a.adjusted_at >= p_from AND a.adjusted_at < p_to, a.amount_vnd, 0)) in_period,
                      SUM(IF(a.adjusted_at < p_to, a.amount_vnd, 0)) before_to
                 FROM fine_adjustments a JOIN fines f ON f.id = a.fine_id
                 JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
                GROUP BY l.reader_id) ad ON ad.reader_id = rd.id
    LEFT JOIN (SELECT reader_id,
                      SUM(IF(paid_at < p_from, amount_vnd, 0)) before_from,
                      SUM(IF(paid_at >= p_from AND paid_at < p_to, amount_vnd, 0)) in_period,
                      SUM(IF(paid_at < p_to, amount_vnd, 0)) before_to
                 FROM fine_payments GROUP BY reader_id) py ON py.reader_id = rd.id
   WHERE (p_reader_id IS NOT NULL AND rd.id = p_reader_id)
      OR (p_reader_id IS NULL AND (fa.reader_id IS NOT NULL OR ad.reader_id IS NOT NULL OR py.reader_id IS NOT NULL))
   ORDER BY rd.id;
END;
--> statement-breakpoint
CREATE VIEW `v_report_overdue` AS
SELECT r.id AS reader_id, r.full_name, b.title, c.barcode, li.id AS loan_item_id, li.due_at,
       fn_days_late(li.due_at, UTC_TIMESTAMP(3)) AS days_late
  FROM loan_items li
  JOIN loans l ON l.id = li.loan_id
  JOIN readers r ON r.id = l.reader_id
  JOIN book_copies c ON c.id = li.copy_id
  JOIN books b ON b.id = c.book_id
 WHERE li.status = 'on_loan' AND li.due_at < UTC_TIMESTAMP(3);
--> statement-breakpoint
CREATE VIEW `v_report_loans_by_month` AS
SELECT DATE_FORMAT(fn_local_date(l.borrowed_at), '%Y-%m') AS month_local, rt.code AS reader_type,
       COUNT(DISTINCT l.id) AS loans, COUNT(li.id) AS items
  FROM loans l
  JOIN readers r ON r.id = l.reader_id
  JOIN reader_types rt ON rt.id = r.reader_type_id
  JOIN loan_items li ON li.loan_id = l.id
 GROUP BY DATE_FORMAT(fn_local_date(l.borrowed_at), '%Y-%m'), rt.code;
--> statement-breakpoint
CREATE VIEW `v_report_popular_books` AS
SELECT b.id AS book_id, b.title, COUNT(li.id) AS loan_items
  FROM books b
  JOIN book_copies c ON c.book_id = b.id
  JOIN loan_items li ON li.copy_id = c.id
 GROUP BY b.id, b.title;
--> statement-breakpoint
CREATE VIEW `v_report_copy_status` AS
SELECT b.id AS book_id, b.title,
       SUM(c.circulation_status = 'available') AS available,
       SUM(c.circulation_status = 'on_loan') AS on_loan,
       SUM(c.circulation_status = 'on_hold') AS on_hold,
       SUM(c.circulation_status = 'in_repair') AS in_repair,
       SUM(c.circulation_status = 'lost') AS lost,
       SUM(c.circulation_status = 'retired') AS retired,
       COUNT(c.id) AS total
  FROM books b
  JOIN book_copies c ON c.book_id = b.id
 GROUP BY b.id, b.title;
