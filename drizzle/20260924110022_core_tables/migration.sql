CREATE TABLE `authors` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`name` varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_authors` (
	`book_id` bigint NOT NULL,
	`author_id` bigint NOT NULL,
	`author_order` tinyint unsigned NOT NULL,
	CONSTRAINT PRIMARY KEY(`book_id`,`author_id`),
	CONSTRAINT `book_authors_order_uq` UNIQUE INDEX(`book_id`,`author_order`),
	CONSTRAINT `book_authors_order_ck` CHECK(author_order >= 1)
);
--> statement-breakpoint
CREATE TABLE `book_categories` (
	`book_id` bigint NOT NULL,
	`category_id` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`book_id`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `book_copies` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`book_id` bigint NOT NULL,
	`barcode` varchar(32) NOT NULL,
	`shelf_code` varchar(50),
	`acquired_at` date,
	`physical_condition` enum('good','worn','damaged') NOT NULL,
	`circulation_status` enum('available','on_loan','on_hold','in_repair','lost','retired') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `book_copies_barcode_uq` UNIQUE INDEX(`barcode`),
	CONSTRAINT `book_copies_id_book_uq` UNIQUE INDEX(`id`,`book_id`),
	CONSTRAINT `book_copies_damaged_not_lendable_ck` CHECK(NOT (physical_condition = 'damaged' AND circulation_status IN ('available','on_hold','on_loan')))
);
--> statement-breakpoint
CREATE TABLE `book_external_refs` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`book_id` bigint NOT NULL,
	`provider` enum('GOOGLE_BOOKS') NOT NULL,
	`external_id` varchar(64) NOT NULL,
	`source_url` varchar(1000),
	`viewability` enum('PARTIAL','ALL_PAGES','NO_PAGES','UNKNOWN'),
	`embeddable` boolean,
	`web_reader_link` varchar(1000),
	`access_country` char(2),
	`raw_snapshot` json NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	CONSTRAINT `book_external_refs_provider_uq` UNIQUE INDEX(`provider`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `book_identifiers` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`book_id` bigint NOT NULL,
	`identifier_type` enum('ISBN_10','ISBN_13','OTHER') NOT NULL,
	`identifier_value` varchar(64) NOT NULL,
	CONSTRAINT `book_identifiers_uq` UNIQUE INDEX(`book_id`,`identifier_type`,`identifier_value`)
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`title` varchar(500) NOT NULL,
	`subtitle` varchar(500),
	`publisher_id` bigint,
	`published_date_text` varchar(10),
	`published_year` smallint,
	`description` text,
	`language_code` varchar(8),
	`cover_url` varchar(1000),
	`material_type_id` bigint NOT NULL,
	`classification_code` varchar(50),
	`replacement_cost_vnd` bigint,
	`status` enum('active','retired') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `books_published_year_ck` CHECK(published_year IS NULL OR published_year BETWEEN 1000 AND 2100),
	CONSTRAINT `books_replacement_cost_ck` CHECK(replacement_cost_vnd IS NULL OR replacement_cost_vnd >= 0)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`name` varchar(150) NOT NULL,
	`parent_id` bigint,
	CONSTRAINT `categories_parent_name_uq` UNIQUE INDEX(`parent_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `material_types` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`code` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `material_types_code_uq` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`name` varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`supabase_user_id` char(36) NOT NULL,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `app_users_supabase_uq` UNIQUE INDEX(`supabase_user_id`)
);
--> statement-breakpoint
CREATE TABLE `library_cards` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`reader_id` bigint NOT NULL,
	`card_number` varchar(32) NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`status` enum('active','expired','lost','revoked') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`active_reader_id` bigint GENERATED ALWAYS AS (IF(status = 'active', reader_id, NULL)) STORED,
	CONSTRAINT `library_cards_number_uq` UNIQUE INDEX(`card_number`),
	CONSTRAINT `library_cards_active_reader_uq` UNIQUE INDEX(`active_reader_id`),
	CONSTRAINT `library_cards_expiry_ck` CHECK(expires_at > issued_at)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`code` varchar(64) NOT NULL,
	`description` varchar(255) NOT NULL,
	CONSTRAINT `permissions_code_uq` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
CREATE TABLE `reader_types` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`code` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `reader_types_code_uq` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
CREATE TABLE `readers` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`user_id` bigint,
	`reader_type_id` bigint NOT NULL,
	`full_name` varchar(200) NOT NULL,
	`email` varchar(320),
	`phone` varchar(20),
	`status` enum('active','suspended','inactive') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `readers_user_uq` UNIQUE INDEX(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` bigint NOT NULL,
	`permission_id` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`code` varchar(64) NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `roles_code_uq` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` bigint NOT NULL,
	`role_id` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `loan_policies` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`reader_type_id` bigint NOT NULL,
	`material_type_id` bigint NOT NULL,
	`max_active_items` smallint NOT NULL,
	`loan_days` smallint NOT NULL,
	`max_renewals` smallint NOT NULL,
	`daily_late_fee_vnd` bigint NOT NULL,
	`debt_block_threshold_vnd` bigint NOT NULL,
	`valid_from` datetime(3) NOT NULL,
	`valid_to` datetime(3),
	`created_by_user_id` bigint NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `loan_policies_max_items_ck` CHECK(max_active_items > 0),
	CONSTRAINT `loan_policies_loan_days_ck` CHECK(loan_days > 0),
	CONSTRAINT `loan_policies_max_renewals_ck` CHECK(max_renewals >= 0),
	CONSTRAINT `loan_policies_fee_ck` CHECK(daily_late_fee_vnd >= 0),
	CONSTRAINT `loan_policies_threshold_ck` CHECK(debt_block_threshold_vnd >= 0),
	CONSTRAINT `loan_policies_period_ck` CHECK(valid_to IS NULL OR valid_to > valid_from)
);
--> statement-breakpoint
CREATE TABLE `loan_items` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`loan_id` bigint NOT NULL,
	`copy_id` bigint NOT NULL,
	`policy_id` bigint NOT NULL,
	`borrowed_at` datetime(3) NOT NULL,
	`due_at` datetime(3) NOT NULL,
	`returned_at` datetime(3),
	`return_condition` enum('good','worn','damaged'),
	`lost_declared_at` datetime(3),
	`status` enum('on_loan','returned','lost') NOT NULL,
	`renewal_count` smallint NOT NULL DEFAULT 0,
	`applied_loan_days` smallint NOT NULL,
	`applied_max_renewals` smallint NOT NULL,
	`applied_daily_fee_vnd` bigint NOT NULL,
	`open_copy_id` bigint GENERATED ALWAYS AS (IF(status = 'on_loan', copy_id, NULL)) STORED,
	CONSTRAINT `loan_items_open_copy_uq` UNIQUE INDEX(`open_copy_id`),
	CONSTRAINT `loan_items_due_ck` CHECK(due_at > borrowed_at),
	CONSTRAINT `loan_items_returned_ck` CHECK(returned_at IS NULL OR returned_at >= borrowed_at),
	CONSTRAINT `loan_items_lost_ck` CHECK(lost_declared_at IS NULL OR lost_declared_at >= borrowed_at),
	CONSTRAINT `loan_items_renewals_ck` CHECK(renewal_count >= 0 AND renewal_count <= applied_max_renewals),
	CONSTRAINT `loan_items_applied_ck` CHECK(applied_loan_days > 0 AND applied_max_renewals >= 0 AND applied_daily_fee_vnd >= 0),
	CONSTRAINT `loan_items_status_ck` CHECK((status = 'on_loan' AND returned_at IS NULL AND return_condition IS NULL AND lost_declared_at IS NULL)
    OR (status = 'returned' AND returned_at IS NOT NULL AND return_condition IS NOT NULL AND lost_declared_at IS NULL)
    OR (status = 'lost' AND lost_declared_at IS NOT NULL AND returned_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE `loan_renewals` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`loan_item_id` bigint NOT NULL,
	`old_due_at` datetime(3) NOT NULL,
	`new_due_at` datetime(3) NOT NULL,
	`renewed_at` datetime(3) NOT NULL,
	`performed_by_user_id` bigint NOT NULL,
	CONSTRAINT `loan_renewals_due_ck` CHECK(new_due_at > old_due_at)
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`reader_id` bigint NOT NULL,
	`processed_by_user_id` bigint NOT NULL,
	`borrowed_at` datetime(3) NOT NULL,
	`status` enum('open','closed') NOT NULL,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`reader_id` bigint NOT NULL,
	`book_id` bigint NOT NULL,
	`requested_at` datetime(3) NOT NULL,
	`status` enum('waiting','ready','fulfilled','cancelled','expired') NOT NULL,
	`assigned_copy_id` bigint,
	`ready_at` datetime(3),
	`hold_expires_at` datetime(3),
	`fulfilled_loan_item_id` bigint,
	`closed_at` datetime(3),
	`close_reason` varchar(64),
	`closed_by_kind` enum('staff','reader','system'),
	`closed_by_user_id` bigint,
	`active_flag` tinyint GENERATED ALWAYS AS (IF(status IN ('waiting', 'ready'), 1, NULL)) STORED,
	`ready_copy_id` bigint GENERATED ALWAYS AS (IF(status = 'ready', assigned_copy_id, NULL)) STORED,
	CONSTRAINT `reservations_active_uq` UNIQUE INDEX(`reader_id`,`book_id`,`active_flag`),
	CONSTRAINT `reservations_ready_copy_uq` UNIQUE INDEX(`ready_copy_id`),
	CONSTRAINT `reservations_fulfilled_item_uq` UNIQUE INDEX(`fulfilled_loan_item_id`),
	CONSTRAINT `reservations_ready_ck` CHECK(status <> 'ready' OR (assigned_copy_id IS NOT NULL AND ready_at IS NOT NULL AND hold_expires_at > ready_at)),
	CONSTRAINT `reservations_fulfilled_ck` CHECK(status <> 'fulfilled' OR fulfilled_loan_item_id IS NOT NULL),
	CONSTRAINT `reservations_closed_ck` CHECK(status NOT IN ('cancelled', 'expired', 'fulfilled') OR closed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `fine_adjustments` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`fine_id` bigint NOT NULL,
	`amount_vnd` bigint NOT NULL,
	`reason` varchar(500) NOT NULL,
	`adjusted_by_user_id` bigint NOT NULL,
	`adjusted_at` datetime(3) NOT NULL,
	CONSTRAINT `fine_adjustments_amount_ck` CHECK(amount_vnd <> 0),
	CONSTRAINT `fine_adjustments_reason_ck` CHECK(CHAR_LENGTH(TRIM(reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE `fine_payment_allocations` (
	`payment_id` bigint NOT NULL,
	`fine_id` bigint NOT NULL,
	`amount_vnd` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`payment_id`,`fine_id`),
	CONSTRAINT `fine_payment_allocations_amount_ck` CHECK(amount_vnd > 0)
);
--> statement-breakpoint
CREATE TABLE `fine_payments` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`reader_id` bigint NOT NULL,
	`received_by_user_id` bigint NOT NULL,
	`amount_vnd` bigint NOT NULL,
	`paid_at` datetime(3) NOT NULL,
	`method` enum('cash','bank_transfer') NOT NULL,
	`reference_no` varchar(64),
	`request_key` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `fine_payments_request_key_uq` UNIQUE INDEX(`request_key`),
	CONSTRAINT `fine_payments_amount_ck` CHECK(amount_vnd > 0)
);
--> statement-breakpoint
CREATE TABLE `fines` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`loan_item_id` bigint NOT NULL,
	`fine_type` enum('late','damaged','lost') NOT NULL,
	`default_amount_vnd` bigint NOT NULL,
	`assessed_amount_vnd` bigint NOT NULL,
	`reason` varchar(500),
	`assessed_at` datetime(3) NOT NULL,
	`assessed_by_user_id` bigint NOT NULL,
	CONSTRAINT `fines_item_type_uq` UNIQUE INDEX(`loan_item_id`,`fine_type`),
	CONSTRAINT `fines_amounts_ck` CHECK(default_amount_vnd >= 0 AND assessed_amount_vnd >= 0),
	CONSTRAINT `fines_reason_ck` CHECK(assessed_amount_vnd = default_amount_vnd OR CHAR_LENGTH(TRIM(reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX `authors_name_ix` ON `authors` (`name`);--> statement-breakpoint
CREATE INDEX `book_authors_author_ix` ON `book_authors` (`author_id`);--> statement-breakpoint
CREATE INDEX `book_categories_category_ix` ON `book_categories` (`category_id`);--> statement-breakpoint
CREATE INDEX `book_copies_book_status_ix` ON `book_copies` (`book_id`,`circulation_status`);--> statement-breakpoint
CREATE INDEX `book_external_refs_book_ix` ON `book_external_refs` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_identifiers_value_ix` ON `book_identifiers` (`identifier_type`,`identifier_value`);--> statement-breakpoint
CREATE INDEX `books_title_ix` ON `books` (`title`);--> statement-breakpoint
CREATE INDEX `books_published_year_ix` ON `books` (`published_year`);--> statement-breakpoint
CREATE INDEX `publishers_name_ix` ON `publishers` (`name`);--> statement-breakpoint
CREATE INDEX `library_cards_reader_ix` ON `library_cards` (`reader_id`);--> statement-breakpoint
CREATE INDEX `readers_type_ix` ON `readers` (`reader_type_id`);--> statement-breakpoint
CREATE INDEX `role_permissions_permission_ix` ON `role_permissions` (`permission_id`);--> statement-breakpoint
CREATE INDEX `user_roles_role_ix` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE INDEX `loan_policies_pair_from_ix` ON `loan_policies` (`reader_type_id`,`material_type_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `loan_items_copy_status_ix` ON `loan_items` (`copy_id`,`status`);--> statement-breakpoint
CREATE INDEX `loan_items_status_due_ix` ON `loan_items` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `loan_items_loan_ix` ON `loan_items` (`loan_id`);--> statement-breakpoint
CREATE INDEX `loan_items_policy_borrowed_ix` ON `loan_items` (`policy_id`,`borrowed_at`);--> statement-breakpoint
CREATE INDEX `loan_renewals_item_ix` ON `loan_renewals` (`loan_item_id`);--> statement-breakpoint
CREATE INDEX `loans_reader_status_ix` ON `loans` (`reader_id`,`status`);--> statement-breakpoint
CREATE INDEX `loans_reader_borrowed_ix` ON `loans` (`reader_id`,`borrowed_at`);--> statement-breakpoint
CREATE INDEX `reservations_queue_ix` ON `reservations` (`book_id`,`status`,`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `fine_adjustments_fine_ix` ON `fine_adjustments` (`fine_id`);--> statement-breakpoint
CREATE INDEX `fine_adjustments_adjusted_at_ix` ON `fine_adjustments` (`adjusted_at`);--> statement-breakpoint
CREATE INDEX `fine_payment_allocations_fine_ix` ON `fine_payment_allocations` (`fine_id`);--> statement-breakpoint
CREATE INDEX `fine_payments_reader_paid_ix` ON `fine_payments` (`reader_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `fine_payments_paid_ix` ON `fine_payments` (`paid_at`);--> statement-breakpoint
CREATE INDEX `fines_assessed_at_ix` ON `fines` (`assessed_at`);--> statement-breakpoint
ALTER TABLE `book_authors` ADD CONSTRAINT `book_authors_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_authors` ADD CONSTRAINT `book_authors_author_fk` FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_categories` ADD CONSTRAINT `book_categories_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_categories` ADD CONSTRAINT `book_categories_category_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_copies` ADD CONSTRAINT `book_copies_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_external_refs` ADD CONSTRAINT `book_external_refs_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `book_identifiers` ADD CONSTRAINT `book_identifiers_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `books` ADD CONSTRAINT `books_publisher_fk` FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `books` ADD CONSTRAINT `books_material_type_fk` FOREIGN KEY (`material_type_id`) REFERENCES `material_types`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `library_cards` ADD CONSTRAINT `library_cards_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `readers` ADD CONSTRAINT `readers_user_fk` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `readers` ADD CONSTRAINT `readers_type_fk` FOREIGN KEY (`reader_type_id`) REFERENCES `reader_types`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_fk` FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_policies` ADD CONSTRAINT `loan_policies_reader_type_fk` FOREIGN KEY (`reader_type_id`) REFERENCES `reader_types`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_policies` ADD CONSTRAINT `loan_policies_material_type_fk` FOREIGN KEY (`material_type_id`) REFERENCES `material_types`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_policies` ADD CONSTRAINT `loan_policies_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_items` ADD CONSTRAINT `loan_items_loan_fk` FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_items` ADD CONSTRAINT `loan_items_copy_fk` FOREIGN KEY (`copy_id`) REFERENCES `book_copies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_items` ADD CONSTRAINT `loan_items_policy_fk` FOREIGN KEY (`policy_id`) REFERENCES `loan_policies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_renewals` ADD CONSTRAINT `loan_renewals_item_fk` FOREIGN KEY (`loan_item_id`) REFERENCES `loan_items`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loan_renewals` ADD CONSTRAINT `loan_renewals_performed_by_fk` FOREIGN KEY (`performed_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_processed_by_fk` FOREIGN KEY (`processed_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_copy_book_fk` FOREIGN KEY (`assigned_copy_id`,`book_id`) REFERENCES `book_copies`(`id`,`book_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_fulfilled_item_fk` FOREIGN KEY (`fulfilled_loan_item_id`) REFERENCES `loan_items`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_closed_by_fk` FOREIGN KEY (`closed_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_adjustments` ADD CONSTRAINT `fine_adjustments_fine_fk` FOREIGN KEY (`fine_id`) REFERENCES `fines`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_adjustments` ADD CONSTRAINT `fine_adjustments_by_fk` FOREIGN KEY (`adjusted_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_payment_allocations` ADD CONSTRAINT `fine_payment_allocations_payment_fk` FOREIGN KEY (`payment_id`) REFERENCES `fine_payments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_payment_allocations` ADD CONSTRAINT `fine_payment_allocations_fine_fk` FOREIGN KEY (`fine_id`) REFERENCES `fines`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_payments` ADD CONSTRAINT `fine_payments_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fine_payments` ADD CONSTRAINT `fine_payments_received_by_fk` FOREIGN KEY (`received_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_item_fk` FOREIGN KEY (`loan_item_id`) REFERENCES `loan_items`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE `fines` ADD CONSTRAINT `fines_assessed_by_fk` FOREIGN KEY (`assessed_by_user_id`) REFERENCES `app_users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;