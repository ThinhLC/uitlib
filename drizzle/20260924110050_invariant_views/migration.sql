-- Invariant views I-1…I-9 (tasks T027, contracts/reports-and-invariants.md).
-- Each returns one row per violation; a correct database returns zero rows from every view.

CREATE VIEW `v_inv_copy_on_loan` AS
SELECT c.id AS copy_id, c.circulation_status, COUNT(li.id) AS open_items,
       'copy on_loan status disagrees with its on_loan loan items' AS problem
  FROM book_copies c
  LEFT JOIN loan_items li ON li.copy_id = c.id AND li.status = 'on_loan'
 GROUP BY c.id, c.circulation_status
HAVING (c.circulation_status = 'on_loan') <> (COUNT(li.id) = 1) OR COUNT(li.id) > 1;
--> statement-breakpoint
CREATE VIEW `v_inv_copy_on_hold` AS
SELECT c.id AS copy_id, c.circulation_status, COUNT(r.id) AS ready_reservations,
       'copy on_hold status disagrees with its ready reservations' AS problem
  FROM book_copies c
  LEFT JOIN reservations r ON r.assigned_copy_id = c.id AND r.status = 'ready'
 GROUP BY c.id, c.circulation_status
HAVING (c.circulation_status = 'on_hold') <> (COUNT(r.id) = 1) OR COUNT(r.id) > 1;
--> statement-breakpoint
CREATE VIEW `v_inv_queue_available` AS
SELECT DISTINCT r.book_id, c.id AS available_copy_id,
       'book has a waiting reservation and an available copy' AS problem
  FROM reservations r
  JOIN book_copies c ON c.book_id = r.book_id AND c.circulation_status = 'available'
 WHERE r.status = 'waiting';
--> statement-breakpoint
CREATE VIEW `v_inv_loan_status` AS
SELECT l.id AS loan_id, l.status, COUNT(li.id) AS items, SUM(li.status = 'on_loan') AS open_items,
       'loan status disagrees with its items (or loan has no items)' AS problem
  FROM loans l
  LEFT JOIN loan_items li ON li.loan_id = l.id
 GROUP BY l.id, l.status
HAVING COUNT(li.id) = 0
    OR (l.status = 'open') <> (COALESCE(SUM(li.status = 'on_loan'), 0) > 0);
--> statement-breakpoint
CREATE VIEW `v_inv_fine_balance` AS
SELECT f.id AS fine_id, n.net_vnd, n.allocated_vnd,
       'fine allocated amount is negative or exceeds its net amount' AS problem
  FROM fines f
  JOIN (SELECT f2.id,
               f2.assessed_amount_vnd
                 + COALESCE((SELECT SUM(a.amount_vnd) FROM fine_adjustments a WHERE a.fine_id = f2.id), 0) AS net_vnd,
               COALESCE((SELECT SUM(x.amount_vnd) FROM fine_payment_allocations x WHERE x.fine_id = f2.id), 0) AS allocated_vnd
          FROM fines f2) n ON n.id = f.id
 WHERE n.allocated_vnd < 0 OR n.allocated_vnd > n.net_vnd OR n.net_vnd < 0;
--> statement-breakpoint
CREATE VIEW `v_inv_payment_allocation` AS
SELECT p.id AS payment_id, p.amount_vnd, COALESCE(SUM(x.amount_vnd), 0) AS allocated_vnd,
       'payment allocations do not sum to the payment amount' AS problem
  FROM fine_payments p
  LEFT JOIN fine_payment_allocations x ON x.payment_id = p.id
 GROUP BY p.id, p.amount_vnd
HAVING COALESCE(SUM(x.amount_vnd), 0) <> p.amount_vnd
UNION ALL
SELECT p.id, p.amount_vnd, x.amount_vnd,
       'allocation pays a fine of another reader' AS problem
  FROM fine_payments p
  JOIN fine_payment_allocations x ON x.payment_id = p.id
  JOIN fines f ON f.id = x.fine_id
  JOIN loan_items li ON li.id = f.loan_item_id
  JOIN loans l ON l.id = li.loan_id
 WHERE l.reader_id <> p.reader_id;
--> statement-breakpoint
CREATE VIEW `v_inv_damaged_lendable` AS
SELECT c.id AS copy_id, c.physical_condition, c.circulation_status,
       'damaged copy is lendable' AS problem
  FROM book_copies c
 WHERE c.physical_condition = 'damaged' AND c.circulation_status IN ('available', 'on_hold', 'on_loan');
--> statement-breakpoint
CREATE VIEW `v_inv_cards_policies` AS
SELECT lc.reader_id AS subject_id, NULL AS other_id, 'reader has more than one active card' AS problem
  FROM library_cards lc
 WHERE lc.status = 'active'
 GROUP BY lc.reader_id
HAVING COUNT(*) > 1
UNION ALL
SELECT a.id, b.id, 'overlapping loan policy versions for one pair' AS problem
  FROM loan_policies a
  JOIN loan_policies b
    ON b.reader_type_id = a.reader_type_id AND b.material_type_id = a.material_type_id AND b.id > a.id
 WHERE a.valid_from < COALESCE(b.valid_to, '9999-12-31 23:59:59.999')
   AND b.valid_from < COALESCE(a.valid_to, '9999-12-31 23:59:59.999');
--> statement-breakpoint
CREATE VIEW `v_inv_borrow_in_policy` AS
SELECT li.id AS loan_item_id, li.borrowed_at, p.id AS policy_id, p.valid_from, p.valid_to,
       'loan item borrow time is outside its policy version period' AS problem
  FROM loan_items li
  JOIN loan_policies p ON p.id = li.policy_id
 WHERE li.borrowed_at < p.valid_from OR (p.valid_to IS NOT NULL AND li.borrowed_at >= p.valid_to);
