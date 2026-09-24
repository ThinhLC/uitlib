-- Money guards (tasks T061; spec FR-016, FR-017a, R-16c, R-17b).

CREATE TRIGGER `trg_fine_payments_bu` BEFORE UPDATE ON `fine_payments`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: payments cannot be updated';
--> statement-breakpoint
CREATE TRIGGER `trg_fine_payments_bd` BEFORE DELETE ON `fine_payments`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: payments cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `trg_fine_payment_allocations_bu` BEFORE UPDATE ON `fine_payment_allocations`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: allocations cannot be updated';
--> statement-breakpoint
CREATE TRIGGER `trg_fine_payment_allocations_bd` BEFORE DELETE ON `fine_payment_allocations`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: allocations cannot be deleted';
--> statement-breakpoint
-- Bypass guard for R-16c: never allocate more than the payment, or more than the fine's net amount.
CREATE TRIGGER `trg_fine_payment_allocations_bi` BEFORE INSERT ON `fine_payment_allocations`
FOR EACH ROW
BEGIN
  IF COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE payment_id = NEW.payment_id), 0)
       + NEW.amount_vnd > (SELECT amount_vnd FROM fine_payments WHERE id = NEW.payment_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: allocations exceed the payment amount';
  END IF;
  IF COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE fine_id = NEW.fine_id), 0)
       + NEW.amount_vnd > fn_fine_net(NEW.fine_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: allocations exceed the fine net amount';
  END IF;
END;
