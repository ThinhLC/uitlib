ALTER TABLE `reservations` DROP CONSTRAINT `reservations_ready_ck`;--> statement-breakpoint
ALTER TABLE `fines` DROP CONSTRAINT `fines_reason_ck`;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_ready_ck` CHECK (status <> 'ready' OR (assigned_copy_id IS NOT NULL AND ready_at IS NOT NULL AND hold_expires_at IS NOT NULL AND hold_expires_at > ready_at));--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_reason_ck` CHECK (assessed_amount_vnd = default_amount_vnd OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0));