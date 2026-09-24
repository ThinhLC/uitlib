
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `app_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `supabase_user_id` char(36) NOT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `app_users_supabase_uq` (`supabase_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `authors` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `authors_name_ix` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `book_authors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `book_authors` (
  `book_id` bigint NOT NULL,
  `author_id` bigint NOT NULL,
  `author_order` tinyint unsigned NOT NULL,
  PRIMARY KEY (`book_id`,`author_id`),
  UNIQUE KEY `book_authors_order_uq` (`book_id`,`author_order`),
  KEY `book_authors_author_ix` (`author_id`),
  CONSTRAINT `book_authors_author_fk` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `book_authors_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `book_authors_order_ck` CHECK ((`author_order` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `book_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `book_categories` (
  `book_id` bigint NOT NULL,
  `category_id` bigint NOT NULL,
  PRIMARY KEY (`book_id`,`category_id`),
  KEY `book_categories_category_ix` (`category_id`),
  CONSTRAINT `book_categories_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `book_categories_category_fk` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `book_copies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `book_copies` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `book_id` bigint NOT NULL,
  `barcode` varchar(32) NOT NULL,
  `shelf_code` varchar(50) DEFAULT NULL,
  `acquired_at` date DEFAULT NULL,
  `physical_condition` enum('good','worn','damaged') NOT NULL,
  `circulation_status` enum('available','on_loan','on_hold','in_repair','lost','retired') NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `book_copies_barcode_uq` (`barcode`),
  UNIQUE KEY `book_copies_id_book_uq` (`id`,`book_id`),
  KEY `book_copies_book_status_ix` (`book_id`,`circulation_status`),
  CONSTRAINT `book_copies_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `book_copies_damaged_not_lendable_ck` CHECK (((`physical_condition` <> _utf8mb4'damaged') or (`circulation_status` not in (_utf8mb4'available',_utf8mb4'on_hold',_utf8mb4'on_loan'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_book_copies_bu` BEFORE UPDATE ON `book_copies` FOR EACH ROW BEGIN
  DECLARE v_msg VARCHAR(128);
  IF NEW.circulation_status <> OLD.circulation_status THEN
    IF NOT (
         (OLD.circulation_status = 'available' AND NEW.circulation_status IN ('on_loan', 'on_hold', 'in_repair', 'retired'))
      OR (OLD.circulation_status = 'on_loan'   AND NEW.circulation_status IN ('available', 'on_hold', 'in_repair', 'lost'))
      OR (OLD.circulation_status = 'on_hold'   AND NEW.circulation_status IN ('available', 'on_loan'))
      OR (OLD.circulation_status = 'in_repair' AND NEW.circulation_status IN ('available', 'on_hold', 'retired'))
      OR (OLD.circulation_status = 'lost'      AND NEW.circulation_status IN ('available', 'on_hold', 'in_repair', 'retired'))
    ) THEN
      SET v_msg = CONCAT('INVALID_TRANSITION: copy ', OLD.circulation_status, ' -> ', NEW.circulation_status);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
    IF NEW.circulation_status = 'on_loan'
       AND NOT EXISTS (SELECT 1 FROM loan_items WHERE copy_id = NEW.id AND status = 'on_loan') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy enters on_loan without an open loan item';
    END IF;
    IF OLD.circulation_status = 'on_loan'
       AND EXISTS (SELECT 1 FROM loan_items WHERE copy_id = NEW.id AND status = 'on_loan') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy leaves on_loan while a loan item is open';
    END IF;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `book_external_refs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `book_external_refs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `book_id` bigint NOT NULL,
  `provider` enum('GOOGLE_BOOKS') NOT NULL,
  `external_id` varchar(64) NOT NULL,
  `source_url` varchar(1000) DEFAULT NULL,
  `viewability` enum('PARTIAL','ALL_PAGES','NO_PAGES','UNKNOWN') DEFAULT NULL,
  `embeddable` tinyint(1) DEFAULT NULL,
  `web_reader_link` varchar(1000) DEFAULT NULL,
  `access_country` char(2) DEFAULT NULL,
  `raw_snapshot` json NOT NULL,
  `fetched_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `book_external_refs_provider_uq` (`provider`,`external_id`),
  KEY `book_external_refs_book_ix` (`book_id`),
  CONSTRAINT `book_external_refs_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `book_identifiers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `book_identifiers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `book_id` bigint NOT NULL,
  `identifier_type` enum('ISBN_10','ISBN_13','OTHER') NOT NULL,
  `identifier_value` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `book_identifiers_uq` (`book_id`,`identifier_type`,`identifier_value`),
  KEY `book_identifiers_value_ix` (`identifier_type`,`identifier_value`),
  CONSTRAINT `book_identifiers_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `books`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `books` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `title` varchar(500) NOT NULL,
  `subtitle` varchar(500) DEFAULT NULL,
  `publisher_id` bigint DEFAULT NULL,
  `published_date_text` varchar(10) DEFAULT NULL,
  `published_year` smallint DEFAULT NULL,
  `description` text,
  `language_code` varchar(8) DEFAULT NULL,
  `cover_url` varchar(1000) DEFAULT NULL,
  `material_type_id` bigint NOT NULL,
  `classification_code` varchar(50) DEFAULT NULL,
  `replacement_cost_vnd` bigint DEFAULT NULL,
  `status` enum('active','retired') NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `books_title_ix` (`title`),
  KEY `books_published_year_ix` (`published_year`),
  KEY `books_publisher_fk` (`publisher_id`),
  KEY `books_material_type_fk` (`material_type_id`),
  FULLTEXT KEY `books_title_ft` (`title`,`subtitle`),
  CONSTRAINT `books_material_type_fk` FOREIGN KEY (`material_type_id`) REFERENCES `material_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `books_publisher_fk` FOREIGN KEY (`publisher_id`) REFERENCES `publishers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `books_published_year_ck` CHECK (((`published_year` is null) or (`published_year` between 1000 and 2100))),
  CONSTRAINT `books_replacement_cost_ck` CHECK (((`replacement_cost_vnd` is null) or (`replacement_cost_vnd` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `parent_id` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `categories_parent_name_uq` (`parent_id`,`name`),
  CONSTRAINT `categories_parent_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fine_adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fine_adjustments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `fine_id` bigint NOT NULL,
  `amount_vnd` bigint NOT NULL,
  `reason` varchar(500) NOT NULL,
  `adjusted_by_user_id` bigint NOT NULL,
  `adjusted_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fine_adjustments_fine_ix` (`fine_id`),
  KEY `fine_adjustments_adjusted_at_ix` (`adjusted_at`),
  KEY `fine_adjustments_by_fk` (`adjusted_by_user_id`),
  CONSTRAINT `fine_adjustments_by_fk` FOREIGN KEY (`adjusted_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_adjustments_fine_fk` FOREIGN KEY (`fine_id`) REFERENCES `fines` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_adjustments_amount_ck` CHECK ((`amount_vnd` <> 0)),
  CONSTRAINT `fine_adjustments_reason_ck` CHECK ((char_length(trim(`reason`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_adjustments_bi` BEFORE INSERT ON `fine_adjustments` FOR EACH ROW BEGIN
  DECLARE v_net BIGINT;
  DECLARE v_allocated BIGINT;
  SET v_net = fn_fine_net(NEW.fine_id) + NEW.amount_vnd;
  SET v_allocated = COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE fine_id = NEW.fine_id), 0);
  IF v_net < 0 OR v_net < v_allocated THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment would leave the fine below the amount already paid';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_adjustments_bu` BEFORE UPDATE ON `fine_adjustments` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: adjustments cannot be updated' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_adjustments_bd` BEFORE DELETE ON `fine_adjustments` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: adjustments cannot be deleted' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `fine_payment_allocations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fine_payment_allocations` (
  `payment_id` bigint NOT NULL,
  `fine_id` bigint NOT NULL,
  `amount_vnd` bigint NOT NULL,
  PRIMARY KEY (`payment_id`,`fine_id`),
  KEY `fine_payment_allocations_fine_ix` (`fine_id`),
  CONSTRAINT `fine_payment_allocations_fine_fk` FOREIGN KEY (`fine_id`) REFERENCES `fines` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_payment_allocations_payment_fk` FOREIGN KEY (`payment_id`) REFERENCES `fine_payments` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_payment_allocations_amount_ck` CHECK ((`amount_vnd` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_payment_allocations_bi` BEFORE INSERT ON `fine_payment_allocations` FOR EACH ROW BEGIN
  IF COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE payment_id = NEW.payment_id), 0)
       + NEW.amount_vnd > (SELECT amount_vnd FROM fine_payments WHERE id = NEW.payment_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: allocations exceed the payment amount';
  END IF;
  IF COALESCE((SELECT SUM(amount_vnd) FROM fine_payment_allocations WHERE fine_id = NEW.fine_id), 0)
       + NEW.amount_vnd > fn_fine_net(NEW.fine_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALLOCATION_MISMATCH: allocations exceed the fine net amount';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_payment_allocations_bu` BEFORE UPDATE ON `fine_payment_allocations` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: allocations cannot be updated' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_payment_allocations_bd` BEFORE DELETE ON `fine_payment_allocations` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: allocations cannot be deleted' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `fine_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fine_payments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `reader_id` bigint NOT NULL,
  `received_by_user_id` bigint NOT NULL,
  `amount_vnd` bigint NOT NULL,
  `paid_at` datetime(3) NOT NULL,
  `method` enum('cash','bank_transfer') NOT NULL,
  `reference_no` varchar(64) DEFAULT NULL,
  `request_key` varchar(64) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fine_payments_request_key_uq` (`request_key`),
  KEY `fine_payments_reader_paid_ix` (`reader_id`,`paid_at`),
  KEY `fine_payments_paid_ix` (`paid_at`),
  KEY `fine_payments_received_by_fk` (`received_by_user_id`),
  CONSTRAINT `fine_payments_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_payments_received_by_fk` FOREIGN KEY (`received_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fine_payments_amount_ck` CHECK ((`amount_vnd` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_payments_bu` BEFORE UPDATE ON `fine_payments` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: payments cannot be updated' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fine_payments_bd` BEFORE DELETE ON `fine_payments` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: payments cannot be deleted' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `fines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fines` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `loan_item_id` bigint NOT NULL,
  `fine_type` enum('late','damaged','lost') NOT NULL,
  `default_amount_vnd` bigint NOT NULL,
  `assessed_amount_vnd` bigint NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `assessed_at` datetime(3) NOT NULL,
  `assessed_by_user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fines_item_type_uq` (`loan_item_id`,`fine_type`),
  KEY `fines_assessed_at_ix` (`assessed_at`),
  KEY `fines_assessed_by_fk` (`assessed_by_user_id`),
  CONSTRAINT `fines_assessed_by_fk` FOREIGN KEY (`assessed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fines_item_fk` FOREIGN KEY (`loan_item_id`) REFERENCES `loan_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fines_amounts_ck` CHECK (((`default_amount_vnd` >= 0) and (`assessed_amount_vnd` >= 0))),
  CONSTRAINT `fines_reason_ck` CHECK (((`assessed_amount_vnd` = `default_amount_vnd`) or ((`reason` is not null) and (char_length(trim(`reason`)) > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fines_bi` BEFORE INSERT ON `fines` FOR EACH ROW BEGIN
  IF NEW.fine_type IN ('damaged', 'lost') AND EXISTS (
       SELECT 1 FROM fines
        WHERE loan_item_id = NEW.loan_item_id
          AND fine_type = IF(NEW.fine_type = 'damaged', 'lost', 'damaged')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a loan item cannot have both a damaged and a lost fine';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fines_bu` BEFORE UPDATE ON `fines` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: fines cannot be updated; record an adjustment' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_fines_bd` BEFORE DELETE ON `fines` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY: fines cannot be deleted' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `library_cards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `library_cards` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `reader_id` bigint NOT NULL,
  `card_number` varchar(32) NOT NULL,
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `status` enum('active','expired','lost','revoked') NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `active_reader_id` bigint GENERATED ALWAYS AS (if((`status` = _utf8mb4'active'),`reader_id`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `library_cards_number_uq` (`card_number`),
  UNIQUE KEY `library_cards_active_reader_uq` (`active_reader_id`),
  KEY `library_cards_reader_ix` (`reader_id`),
  CONSTRAINT `library_cards_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `library_cards_expiry_ck` CHECK ((`expires_at` > `issued_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `loan_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loan_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `loan_id` bigint NOT NULL,
  `copy_id` bigint NOT NULL,
  `policy_id` bigint NOT NULL,
  `borrowed_at` datetime(3) NOT NULL,
  `due_at` datetime(3) NOT NULL,
  `returned_at` datetime(3) DEFAULT NULL,
  `return_condition` enum('good','worn','damaged') DEFAULT NULL,
  `lost_declared_at` datetime(3) DEFAULT NULL,
  `status` enum('on_loan','returned','lost') NOT NULL,
  `renewal_count` smallint NOT NULL DEFAULT '0',
  `applied_loan_days` smallint NOT NULL,
  `applied_max_renewals` smallint NOT NULL,
  `applied_daily_fee_vnd` bigint NOT NULL,
  `open_copy_id` bigint GENERATED ALWAYS AS (if((`status` = _utf8mb4'on_loan'),`copy_id`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `loan_items_open_copy_uq` (`open_copy_id`),
  KEY `loan_items_copy_status_ix` (`copy_id`,`status`),
  KEY `loan_items_status_due_ix` (`status`,`due_at`),
  KEY `loan_items_loan_ix` (`loan_id`),
  KEY `loan_items_policy_borrowed_ix` (`policy_id`,`borrowed_at`),
  CONSTRAINT `loan_items_copy_fk` FOREIGN KEY (`copy_id`) REFERENCES `book_copies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_items_loan_fk` FOREIGN KEY (`loan_id`) REFERENCES `loans` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_items_policy_fk` FOREIGN KEY (`policy_id`) REFERENCES `loan_policies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_items_applied_ck` CHECK (((`applied_loan_days` > 0) and (`applied_max_renewals` >= 0) and (`applied_daily_fee_vnd` >= 0))),
  CONSTRAINT `loan_items_due_ck` CHECK ((`due_at` > `borrowed_at`)),
  CONSTRAINT `loan_items_lost_ck` CHECK (((`lost_declared_at` is null) or (`lost_declared_at` >= `borrowed_at`))),
  CONSTRAINT `loan_items_renewals_ck` CHECK (((`renewal_count` >= 0) and (`renewal_count` <= `applied_max_renewals`))),
  CONSTRAINT `loan_items_returned_ck` CHECK (((`returned_at` is null) or (`returned_at` >= `borrowed_at`))),
  CONSTRAINT `loan_items_status_ck` CHECK ((((`status` = _utf8mb4'on_loan') and (`returned_at` is null) and (`return_condition` is null) and (`lost_declared_at` is null)) or ((`status` = _utf8mb4'returned') and (`returned_at` is not null) and (`return_condition` is not null) and (`lost_declared_at` is null)) or ((`status` = _utf8mb4'lost') and (`lost_declared_at` is not null) and (`returned_at` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_loan_items_bi` BEFORE INSERT ON `loan_items` FOR EACH ROW BEGIN
  DECLARE v_copy_status VARCHAR(16);
  IF NEW.status <> 'on_loan' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a loan item starts on_loan';
  END IF;
  SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = NEW.copy_id;
  IF v_copy_status IS NULL OR v_copy_status NOT IN ('available', 'on_hold') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_STATE: copy is not available for a new loan item';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_loan_items_bu` BEFORE UPDATE ON `loan_items` FOR EACH ROW BEGIN
  DECLARE v_msg VARCHAR(128);
  -- R-11a: identity and the applied-policy snapshot never change.
  IF NOT (NEW.loan_id <=> OLD.loan_id
      AND NEW.copy_id <=> OLD.copy_id
      AND NEW.policy_id <=> OLD.policy_id
      AND NEW.borrowed_at <=> OLD.borrowed_at
      AND NEW.applied_loan_days <=> OLD.applied_loan_days
      AND NEW.applied_max_renewals <=> OLD.applied_max_renewals
      AND NEW.applied_daily_fee_vnd <=> OLD.applied_daily_fee_vnd) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNAPSHOT_IMMUTABLE: loan item identity or policy snapshot changed';
  END IF;
  -- R-11c: on_loan → returned | lost; both terminal.
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'on_loan' AND NEW.status IN ('returned', 'lost')) THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: loan item ', OLD.status, ' -> ', NEW.status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  -- The due time moves only forward, and only while the item is on loan (renewal).
  IF NOT (NEW.due_at <=> OLD.due_at) AND (OLD.status <> 'on_loan' OR NEW.due_at <= OLD.due_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SNAPSHOT_IMMUTABLE: due time may only move later while on loan';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `loan_policies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loan_policies` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `reader_type_id` bigint NOT NULL,
  `material_type_id` bigint NOT NULL,
  `max_active_items` smallint NOT NULL,
  `loan_days` smallint NOT NULL,
  `max_renewals` smallint NOT NULL,
  `daily_late_fee_vnd` bigint NOT NULL,
  `debt_block_threshold_vnd` bigint NOT NULL,
  `valid_from` datetime(3) NOT NULL,
  `valid_to` datetime(3) DEFAULT NULL,
  `created_by_user_id` bigint NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `loan_policies_pair_from_ix` (`reader_type_id`,`material_type_id`,`valid_from`),
  KEY `loan_policies_material_type_fk` (`material_type_id`),
  KEY `loan_policies_created_by_fk` (`created_by_user_id`),
  CONSTRAINT `loan_policies_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_policies_material_type_fk` FOREIGN KEY (`material_type_id`) REFERENCES `material_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_policies_reader_type_fk` FOREIGN KEY (`reader_type_id`) REFERENCES `reader_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_policies_fee_ck` CHECK ((`daily_late_fee_vnd` >= 0)),
  CONSTRAINT `loan_policies_loan_days_ck` CHECK ((`loan_days` > 0)),
  CONSTRAINT `loan_policies_max_items_ck` CHECK ((`max_active_items` > 0)),
  CONSTRAINT `loan_policies_max_renewals_ck` CHECK ((`max_renewals` >= 0)),
  CONSTRAINT `loan_policies_period_ck` CHECK (((`valid_to` is null) or (`valid_to` > `valid_from`))),
  CONSTRAINT `loan_policies_threshold_ck` CHECK ((`debt_block_threshold_vnd` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_loan_policies_bi` BEFORE INSERT ON `loan_policies` FOR EACH ROW BEGIN
  IF EXISTS (
    SELECT 1 FROM loan_policies p
     WHERE p.reader_type_id = NEW.reader_type_id
       AND p.material_type_id = NEW.material_type_id
       AND p.valid_from < COALESCE(NEW.valid_to, '9999-12-31 23:59:59.999')
       AND COALESCE(p.valid_to, '9999-12-31 23:59:59.999') > NEW.valid_from) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_OVERLAP: another version of this pair overlaps';
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_loan_policies_bu` BEFORE UPDATE ON `loan_policies` FOR EACH ROW BEGIN
  IF NOT (NEW.reader_type_id <=> OLD.reader_type_id
      AND NEW.material_type_id <=> OLD.material_type_id
      AND NEW.max_active_items <=> OLD.max_active_items
      AND NEW.loan_days <=> OLD.loan_days
      AND NEW.max_renewals <=> OLD.max_renewals
      AND NEW.daily_late_fee_vnd <=> OLD.daily_late_fee_vnd
      AND NEW.debt_block_threshold_vnd <=> OLD.debt_block_threshold_vnd
      AND NEW.valid_from <=> OLD.valid_from
      AND NEW.created_by_user_id <=> OLD.created_by_user_id
      AND NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_IMMUTABLE: business values of a policy version cannot change';
  END IF;
  IF NOT (NEW.valid_to <=> OLD.valid_to) THEN
    IF NEW.valid_to IS NULL OR (OLD.valid_to IS NOT NULL AND NEW.valid_to >= OLD.valid_to) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_IMMUTABLE: valid_to may only be set or moved earlier';
    END IF;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `loan_renewals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loan_renewals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `loan_item_id` bigint NOT NULL,
  `old_due_at` datetime(3) NOT NULL,
  `new_due_at` datetime(3) NOT NULL,
  `renewed_at` datetime(3) NOT NULL,
  `performed_by_user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  KEY `loan_renewals_item_ix` (`loan_item_id`),
  KEY `loan_renewals_performed_by_fk` (`performed_by_user_id`),
  CONSTRAINT `loan_renewals_item_fk` FOREIGN KEY (`loan_item_id`) REFERENCES `loan_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_renewals_performed_by_fk` FOREIGN KEY (`performed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loan_renewals_due_ck` CHECK ((`new_due_at` > `old_due_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `loans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loans` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `reader_id` bigint NOT NULL,
  `processed_by_user_id` bigint NOT NULL,
  `borrowed_at` datetime(3) NOT NULL,
  `status` enum('open','closed') NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `loans_reader_status_ix` (`reader_id`,`status`),
  KEY `loans_reader_borrowed_ix` (`reader_id`,`borrowed_at`),
  KEY `loans_processed_by_fk` (`processed_by_user_id`),
  CONSTRAINT `loans_processed_by_fk` FOREIGN KEY (`processed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `loans_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `material_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `material_types` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `material_types_code_uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `permissions_code_uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `publishers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publishers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `publishers_name_ix` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reader_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reader_types` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reader_types_code_uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `readers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `readers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint DEFAULT NULL,
  `reader_type_id` bigint NOT NULL,
  `full_name` varchar(200) NOT NULL,
  `email` varchar(320) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `status` enum('active','suspended','inactive') NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `readers_user_uq` (`user_id`),
  KEY `readers_type_ix` (`reader_type_id`),
  CONSTRAINT `readers_type_fk` FOREIGN KEY (`reader_type_id`) REFERENCES `reader_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `readers_user_fk` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reservations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `reader_id` bigint NOT NULL,
  `book_id` bigint NOT NULL,
  `requested_at` datetime(3) NOT NULL,
  `status` enum('waiting','ready','fulfilled','cancelled','expired') NOT NULL,
  `assigned_copy_id` bigint DEFAULT NULL,
  `ready_at` datetime(3) DEFAULT NULL,
  `hold_expires_at` datetime(3) DEFAULT NULL,
  `fulfilled_loan_item_id` bigint DEFAULT NULL,
  `closed_at` datetime(3) DEFAULT NULL,
  `close_reason` varchar(64) DEFAULT NULL,
  `closed_by_kind` enum('staff','reader','system') DEFAULT NULL,
  `closed_by_user_id` bigint DEFAULT NULL,
  `active_flag` tinyint GENERATED ALWAYS AS (if((`status` in (_utf8mb4'waiting',_utf8mb4'ready')),1,NULL)) STORED,
  `ready_copy_id` bigint GENERATED ALWAYS AS (if((`status` = _utf8mb4'ready'),`assigned_copy_id`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservations_active_uq` (`reader_id`,`book_id`,`active_flag`),
  UNIQUE KEY `reservations_ready_copy_uq` (`ready_copy_id`),
  UNIQUE KEY `reservations_fulfilled_item_uq` (`fulfilled_loan_item_id`),
  KEY `reservations_queue_ix` (`book_id`,`status`,`requested_at`,`id`),
  KEY `reservations_copy_book_fk` (`assigned_copy_id`,`book_id`),
  KEY `reservations_closed_by_fk` (`closed_by_user_id`),
  CONSTRAINT `reservations_book_fk` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `reservations_closed_by_fk` FOREIGN KEY (`closed_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `reservations_copy_book_fk` FOREIGN KEY (`assigned_copy_id`, `book_id`) REFERENCES `book_copies` (`id`, `book_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `reservations_fulfilled_item_fk` FOREIGN KEY (`fulfilled_loan_item_id`) REFERENCES `loan_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `reservations_reader_fk` FOREIGN KEY (`reader_id`) REFERENCES `readers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `reservations_closed_ck` CHECK (((`status` not in (_utf8mb4'cancelled',_utf8mb4'expired',_utf8mb4'fulfilled')) or (`closed_at` is not null))),
  CONSTRAINT `reservations_fulfilled_ck` CHECK (((`status` <> _utf8mb4'fulfilled') or (`fulfilled_loan_item_id` is not null))),
  CONSTRAINT `reservations_ready_ck` CHECK (((`status` <> _utf8mb4'ready') or ((`assigned_copy_id` is not null) and (`ready_at` is not null) and (`hold_expires_at` is not null) and (`hold_expires_at` > `ready_at`))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_reservations_bu` BEFORE UPDATE ON `reservations` FOR EACH ROW BEGIN
  DECLARE v_msg VARCHAR(128);
  IF NEW.reader_id <> OLD.reader_id OR NEW.book_id <> OLD.book_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a reservation cannot change reader or book';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'waiting' AND NEW.status IN ('ready', 'cancelled'))
    OR (OLD.status = 'ready'   AND NEW.status IN ('fulfilled', 'expired', 'cancelled'))) THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: reservation ', OLD.status, ' -> ', NEW.status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `role_id` bigint NOT NULL,
  `permission_id` bigint NOT NULL,
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `role_permissions_permission_ix` (`permission_id`),
  CONSTRAINT `role_permissions_permission_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `role_permissions_role_fk` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(64) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_code_uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_roles` (
  `user_id` bigint NOT NULL,
  `role_id` bigint NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `user_roles_role_ix` (`role_id`),
  CONSTRAINT `user_roles_role_fk` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `user_roles_user_fk` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `v_inv_borrow_in_policy`;
/*!50001 DROP VIEW IF EXISTS `v_inv_borrow_in_policy`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_borrow_in_policy` AS SELECT 
 1 AS `loan_item_id`,
 1 AS `borrowed_at`,
 1 AS `policy_id`,
 1 AS `valid_from`,
 1 AS `valid_to`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_cards_policies`;
/*!50001 DROP VIEW IF EXISTS `v_inv_cards_policies`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_cards_policies` AS SELECT 
 1 AS `subject_id`,
 1 AS `other_id`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_copy_on_hold`;
/*!50001 DROP VIEW IF EXISTS `v_inv_copy_on_hold`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_copy_on_hold` AS SELECT 
 1 AS `copy_id`,
 1 AS `circulation_status`,
 1 AS `ready_reservations`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_copy_on_loan`;
/*!50001 DROP VIEW IF EXISTS `v_inv_copy_on_loan`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_copy_on_loan` AS SELECT 
 1 AS `copy_id`,
 1 AS `circulation_status`,
 1 AS `open_items`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_damaged_lendable`;
/*!50001 DROP VIEW IF EXISTS `v_inv_damaged_lendable`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_damaged_lendable` AS SELECT 
 1 AS `copy_id`,
 1 AS `physical_condition`,
 1 AS `circulation_status`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_fine_balance`;
/*!50001 DROP VIEW IF EXISTS `v_inv_fine_balance`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_fine_balance` AS SELECT 
 1 AS `fine_id`,
 1 AS `net_vnd`,
 1 AS `allocated_vnd`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_loan_status`;
/*!50001 DROP VIEW IF EXISTS `v_inv_loan_status`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_loan_status` AS SELECT 
 1 AS `loan_id`,
 1 AS `status`,
 1 AS `items`,
 1 AS `open_items`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_payment_allocation`;
/*!50001 DROP VIEW IF EXISTS `v_inv_payment_allocation`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_payment_allocation` AS SELECT 
 1 AS `payment_id`,
 1 AS `amount_vnd`,
 1 AS `allocated_vnd`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_inv_queue_available`;
/*!50001 DROP VIEW IF EXISTS `v_inv_queue_available`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inv_queue_available` AS SELECT 
 1 AS `book_id`,
 1 AS `available_copy_id`,
 1 AS `problem`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_report_copy_status`;
/*!50001 DROP VIEW IF EXISTS `v_report_copy_status`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_report_copy_status` AS SELECT 
 1 AS `book_id`,
 1 AS `title`,
 1 AS `available`,
 1 AS `on_loan`,
 1 AS `on_hold`,
 1 AS `in_repair`,
 1 AS `lost`,
 1 AS `retired`,
 1 AS `total`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_report_loans_by_month`;
/*!50001 DROP VIEW IF EXISTS `v_report_loans_by_month`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_report_loans_by_month` AS SELECT 
 1 AS `month_local`,
 1 AS `reader_type`,
 1 AS `loans`,
 1 AS `items`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_report_overdue`;
/*!50001 DROP VIEW IF EXISTS `v_report_overdue`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_report_overdue` AS SELECT 
 1 AS `reader_id`,
 1 AS `full_name`,
 1 AS `title`,
 1 AS `barcode`,
 1 AS `loan_item_id`,
 1 AS `due_at`,
 1 AS `days_late`*/;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `v_report_popular_books`;
/*!50001 DROP VIEW IF EXISTS `v_report_popular_books`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_report_popular_books` AS SELECT 
 1 AS `book_id`,
 1 AS `title`,
 1 AS `loan_items`*/;
SET character_set_client = @saved_cs_client;
/*!50106 SET @save_time_zone= @@TIME_ZONE */ ;
/*!50106 DROP EVENT IF EXISTS `ev_expire_holds` */;
DELIMITER ;;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;;
/*!50003 SET character_set_client  = utf8mb4 */ ;;
/*!50003 SET character_set_results = utf8mb4 */ ;;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;;
/*!50003 SET @saved_time_zone      = @@time_zone */ ;;
/*!50003 SET time_zone             = '+00:00' */ ;;
/*!50106 CREATE*/ /*!50117 DEFINER=`root`@`%`*/ /*!50106 EVENT `ev_expire_holds` ON SCHEDULE EVERY 15 MINUTE STARTS '2026-09-24 15:57:00' ON COMPLETION PRESERVE ENABLE COMMENT 'Expire ready reservations past their hold expiry and promote the queue' DO CALL sp__expire_holds_batch(UTC_TIMESTAMP(3), @expired_count) */ ;;
/*!50003 SET time_zone             = @saved_time_zone */ ;;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;;
/*!50003 SET character_set_client  = @saved_cs_client */ ;;
/*!50003 SET character_set_results = @saved_cs_results */ ;;
/*!50003 SET collation_connection  = @saved_col_connection */ ;;
DELIMITER ;
/*!50106 SET TIME_ZONE= @save_time_zone */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_days_late` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_days_late`(p_due_at DATETIME(3), p_end_at DATETIME(3)) RETURNS int
    DETERMINISTIC
    COMMENT 'Whole local calendar days between the due date and the end event, minimum 0 (FR-015a)'
RETURN GREATEST(0, DATEDIFF(fn_local_date(p_end_at), fn_local_date(p_due_at))) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_due_at` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_due_at`(p_borrowed_at DATETIME(3), p_loan_days INT) RETURNS datetime(3)
    DETERMINISTIC
    COMMENT 'UTC instant of 23:59:59.999 local time, loan_days after the local borrow date (FR-011)'
RETURN TIMESTAMP(fn_local_date(p_borrowed_at) + INTERVAL p_loan_days DAY, '23:59:59.999') - INTERVAL 7 HOUR ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_fine_net` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_fine_net`(p_fine_id BIGINT) RETURNS bigint
    READS SQL DATA
    COMMENT 'Assessed amount plus all adjustments (reports only; decisions use locking reads)'
RETURN (SELECT f.assessed_amount_vnd
               + COALESCE((SELECT SUM(a.amount_vnd) FROM fine_adjustments a WHERE a.fine_id = f.id), 0)
          FROM fines f WHERE f.id = p_fine_id) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_fine_remaining` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_fine_remaining`(p_fine_id BIGINT) RETURNS bigint
    READS SQL DATA
    COMMENT 'Net amount minus allocations (reports only; decisions use locking reads)'
RETURN fn_fine_net(p_fine_id)
       - COALESCE((SELECT SUM(x.amount_vnd) FROM fine_payment_allocations x WHERE x.fine_id = p_fine_id), 0) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_has_permission` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_has_permission`(p_user_id BIGINT, p_code VARCHAR(64)) RETURNS tinyint(1)
    READS SQL DATA
    COMMENT 'TRUE if the account exists, is active and one of its roles grants the permission'
RETURN EXISTS (
  SELECT 1
    FROM app_users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE u.id = p_user_id AND u.status = 'active' AND p.code = p_code) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_late_fee` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_late_fee`(p_days INT, p_daily_fee BIGINT, p_cap BIGINT) RETURNS bigint
    DETERMINISTIC
    COMMENT 'days x daily fee, capped at p_cap when it is not NULL (D2)'
RETURN IF(p_cap IS NULL, p_days * p_daily_fee, LEAST(p_days * p_daily_fee, p_cap)) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_local_date` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_local_date`(p_ts DATETIME(3)) RETURNS date
    DETERMINISTIC
    COMMENT 'Library-local calendar date of a UTC instant'
RETURN DATE(p_ts + INTERVAL 7 HOUR) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP FUNCTION IF EXISTS `fn_reader_outstanding` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` FUNCTION `fn_reader_outstanding`(p_reader_id BIGINT, p_as_of DATETIME(3)) RETURNS bigint
    READS SQL DATA
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
               WHERE p.reader_id = p_reader_id AND p.paid_at <= p_as_of), 0) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_adjust_fine` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_adjust_fine`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_fine_id BIGINT,
  IN p_amount_vnd BIGINT,
  IN p_reason VARCHAR(500),
  OUT p_adjustment_id BIGINT)
    COMMENT 'Record an audited, signed correction to a fine (FR-017)'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_assessed BIGINT;
  DECLARE v_adjusted BIGINT;
  DECLARE v_allocated BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'fine.adjust') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: fine.adjust required';
  END IF;
  IF p_amount_vnd IS NULL OR p_amount_vnd = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment amount must be non-zero';
  END IF;
  IF p_reason IS NULL OR CHAR_LENGTH(TRIM(p_reason)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: an adjustment needs a reason';
  END IF;

  START TRANSACTION;
  -- The fine's reader decides the first lock (reader → fine); it never changes.
  SELECT l.reader_id INTO v_reader
    FROM fines f JOIN loan_items li ON li.id = f.loan_item_id JOIN loans l ON l.id = li.loan_id
   WHERE f.id = p_fine_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: fine';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT assessed_amount_vnd INTO v_assessed FROM fines WHERE id = p_fine_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_adjusted FROM fine_adjustments WHERE fine_id = p_fine_id FOR SHARE;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_allocated FROM fine_payment_allocations WHERE fine_id = p_fine_id FOR SHARE;
  IF v_assessed + v_adjusted + p_amount_vnd < v_allocated OR v_assessed + v_adjusted + p_amount_vnd < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: adjustment would leave the fine below the amount already paid';
  END IF;

  INSERT INTO fine_adjustments (fine_id, amount_vnd, reason, adjusted_by_user_id, adjusted_at)
  VALUES (p_fine_id, p_amount_vnd, p_reason, p_actor_user_id, p_now);
  SET p_adjustment_id = LAST_INSERT_ID();
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_cancel_reservation` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_cancel_reservation`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reservation_id BIGINT,
  IN p_reason VARCHAR(500))
    COMMENT '[Ext] Cancel a waiting or ready reservation; a ready one passes its copy to the queue'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_copy BIGINT;
  DECLARE v_kind VARCHAR(8);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  -- Immutable ids (the trigger forbids changing reader or book); they decide permission and locks.
  SELECT reader_id, book_id INTO v_reader, v_book FROM reservations WHERE id = p_reservation_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reservation';
  END IF;
  IF fn_has_permission(p_actor_user_id, 'reservation.manage') THEN
    SET v_kind = 'staff';
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: staff cancellation needs a reason';
    END IF;
  ELSEIF EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
                  WHERE r.id = v_reader AND u.id = p_actor_user_id AND u.status = 'active') THEN
    SET v_kind = 'reader';
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required, or cancel your own';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT status, assigned_copy_id INTO v_status, v_copy FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_status NOT IN ('waiting', 'ready') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: reservation is ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  IF v_status = 'ready' THEN
    SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
  END IF;

  UPDATE reservations
     SET status = 'cancelled', closed_at = p_now, closed_by_kind = v_kind, closed_by_user_id = p_actor_user_id,
         close_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'cancelled_by_reader')
   WHERE id = p_reservation_id;
  IF v_status = 'ready' THEN
    CALL sp__promote_queue(v_copy, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_change_copy_status` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_change_copy_status`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_copy_id BIGINT,
  IN p_target_status VARCHAR(16),
  IN p_condition VARCHAR(16))
    COMMENT 'Librarian copy maintenance: repair, repair done, found, retire (FR-006a)'
BEGIN
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_condition VARCHAR(16);
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
  SELECT circulation_status, physical_condition INTO v_status, v_condition FROM book_copies WHERE id = p_copy_id FOR UPDATE;
  IF v_status IN ('on_loan', 'on_hold') THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: copy is ', v_status, '; use the circulation procedures');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  -- A damaged copy is never lendable (FR-006a): the condition must be updated in the same call.
  IF p_target_status = 'available' AND COALESCE(p_condition, v_condition) = 'damaged' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: a damaged copy cannot be made available; update its condition';
  END IF;

  -- One statement, so the CHECK and the lifecycle trigger see the final row.
  UPDATE book_copies
     SET physical_condition = COALESCE(p_condition, physical_condition),
         circulation_status = p_target_status,
         updated_at = p_now
   WHERE id = p_copy_id;
  -- [Ext] Repair done or found: the book's queue gets the copy first (FR-006a, FR-014b).
  IF p_target_status = 'available' THEN
    CALL sp__promote_queue(p_copy_id, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_checkout` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_checkout`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_copy_ids JSON)
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
  DECLARE v_res BIGINT;
  DECLARE v_holder BIGINT;
  DECLARE v_hold_until DATETIME(3);
  DECLARE v_held INT DEFAULT 0;
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
    max_items SMALLINT NULL,
    on_hold TINYINT NOT NULL DEFAULT 0,
    reservation_id BIGINT NULL);
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

  -- 5. Lock the copies in ascending id; each must be available, or [Ext] on hold (resolved in 6b).
  SET v_i = 0;
  WHILE v_i < v_n DO
    SELECT copy_id INTO v_id FROM tmp_checkout ORDER BY copy_id LIMIT v_i, 1;
    SELECT circulation_status INTO v_copy_status FROM book_copies WHERE id = v_id FOR UPDATE;
    IF v_copy_status = 'on_hold' THEN
      UPDATE tmp_checkout SET on_hold = 1 WHERE copy_id = v_id;
    ELSEIF v_copy_status <> 'available' THEN
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

  -- 6b. [Ext] Held copies (lock order: … policy → reservation). A hold whose expiry has passed is
  --     expired here and the queue promoted (FR-014c "on demand when scanned"); the copy may then
  --     be free, or held for the next reader. Only the holder may borrow a held copy (R-14f).
  SELECT COUNT(*) INTO v_held FROM tmp_checkout WHERE on_hold = 1;
  SET v_i = 0;
  WHILE v_i < v_held DO
    SELECT copy_id INTO v_id FROM tmp_checkout WHERE on_hold = 1 ORDER BY copy_id LIMIT v_i, 1;
    SET v_res = NULL;
    SELECT id, reader_id, hold_expires_at INTO v_res, v_holder, v_hold_until
      FROM reservations WHERE ready_copy_id = v_id FOR UPDATE;
    IF v_res IS NOT NULL AND v_hold_until <= p_now THEN
      UPDATE reservations
         SET status = 'expired', closed_at = p_now, closed_by_kind = 'system', close_reason = 'hold_expired'
       WHERE id = v_res;
      CALL sp__promote_queue(v_id, p_actor_user_id, p_now);
      SET v_res = NULL;
      SELECT id, reader_id INTO v_res, v_holder FROM reservations WHERE ready_copy_id = v_id FOR UPDATE;
    END IF;
    IF v_res IS NOT NULL THEN
      IF v_holder <> p_reader_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COPY_NOT_AVAILABLE: the copy is held for another reader';
      END IF;
      UPDATE tmp_checkout SET reservation_id = v_res WHERE copy_id = v_id;
    END IF;
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
  -- [Ext] The holder's reservations are fulfilled by the new loan items (before the copies leave on_hold).
  UPDATE reservations r
    JOIN tmp_checkout t ON t.reservation_id = r.id
    JOIN loan_items li ON li.loan_id = v_loan AND li.copy_id = t.copy_id
     SET r.status = 'fulfilled', r.fulfilled_loan_item_id = li.id, r.closed_at = p_now,
         r.closed_by_kind = 'staff', r.closed_by_user_id = p_actor_user_id;
  UPDATE book_copies c JOIN tmp_checkout t ON t.copy_id = c.id
     SET c.circulation_status = 'on_loan', c.updated_at = p_now;
  COMMIT;

  DROP TEMPORARY TABLE IF EXISTS tmp_checkout;
  SELECT loan_id, id AS loan_item_id, copy_id, due_at FROM loan_items WHERE loan_id = v_loan ORDER BY id;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_close_policy_version` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_close_policy_version`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_policy_id BIGINT,
  IN p_valid_to DATETIME(3))
    COMMENT 'Close a policy version: not retroactive, only earlier, after every referencing borrow (FR-009c)'
BEGIN
  DECLARE v_reader_type BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_from DATETIME(3);
  DECLARE v_to DATETIME(3);
  DECLARE v_last_borrow DATETIME(3);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'policy.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: policy.manage required';
  END IF;
  IF p_valid_to IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to is required';
  END IF;

  START TRANSACTION;
  -- The reader type only decides the first lock (global order reader type → version); it never changes.
  SELECT reader_type_id INTO v_reader_type FROM loan_policies WHERE id = p_policy_id;
  IF v_reader_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: policy version';
  END IF;
  SELECT id INTO v_locked FROM reader_types WHERE id = v_reader_type FOR UPDATE;
  SELECT valid_from, valid_to INTO v_from, v_to FROM loan_policies WHERE id = p_policy_id FOR UPDATE;

  IF p_valid_to < p_now THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: retroactive close';
  END IF;
  IF p_valid_to <= v_from THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to must be after valid_from';
  END IF;
  IF v_to IS NOT NULL AND p_valid_to >= v_to THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: valid_to may only move earlier';
  END IF;
  -- Locking read (research R5): a concurrent checkout under this version serializes with us.
  SELECT MAX(borrowed_at) INTO v_last_borrow FROM loan_items WHERE policy_id = p_policy_id FOR SHARE;
  IF v_last_borrow IS NOT NULL AND p_valid_to <= v_last_borrow THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_CLOSE_REJECTED: a loan was borrowed under this version at or after valid_to';
  END IF;

  UPDATE loan_policies SET valid_to = p_valid_to WHERE id = p_policy_id;
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_create_policy_version` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_create_policy_version`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_type_id BIGINT,
  IN p_material_type_id BIGINT,
  IN p_max_active_items SMALLINT,
  IN p_loan_days SMALLINT,
  IN p_max_renewals SMALLINT,
  IN p_daily_late_fee_vnd BIGINT,
  IN p_debt_block_threshold_vnd BIGINT,
  IN p_valid_from DATETIME(3),
  OUT p_policy_id BIGINT)
    COMMENT 'Create an open-ended policy version for a (reader type, material type) pair (FR-009)'
BEGIN
  DECLARE v_locked BIGINT;
  DECLARE v_material BIGINT;
  DECLARE v_overlaps INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'policy.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: policy.manage required';
  END IF;
  IF p_valid_from IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: valid_from is required';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM reader_types WHERE id = p_reader_type_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader type';
  END IF;
  SELECT id INTO v_material FROM material_types WHERE id = p_material_type_id FOR SHARE;
  IF v_material IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: material type';
  END IF;

  -- The new version is open-ended [valid_from, ∞): it overlaps any version still in effect after valid_from.
  SELECT COUNT(*) INTO v_overlaps
    FROM loan_policies
   WHERE reader_type_id = p_reader_type_id
     AND material_type_id = p_material_type_id
     AND (valid_to IS NULL OR valid_to > p_valid_from)
     FOR UPDATE;
  IF v_overlaps > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POLICY_OVERLAP: close the current version first';
  END IF;

  INSERT INTO loan_policies
    (reader_type_id, material_type_id, max_active_items, loan_days, max_renewals, daily_late_fee_vnd,
     debt_block_threshold_vnd, valid_from, valid_to, created_by_user_id, created_at)
  VALUES
    (p_reader_type_id, p_material_type_id, p_max_active_items, p_loan_days, p_max_renewals, p_daily_late_fee_vnd,
     p_debt_block_threshold_vnd, p_valid_from, NULL, p_actor_user_id, p_now);
  SET p_policy_id = LAST_INSERT_ID();
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_declare_lost` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_declare_lost`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  IN p_lost_fine_vnd BIGINT,
  IN p_reason VARCHAR(500))
    COMMENT 'Declare a loaned copy lost: late fine to now plus lost fine; returns the assessed fines'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_loan BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.return') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.return required';
  END IF;

  START TRANSACTION;
  SELECT l.reader_id, c.book_id, li.copy_id, li.loan_id INTO v_reader, v_book, v_copy, v_loan
    FROM loan_items li JOIN loans l ON l.id = li.loan_id JOIN book_copies c ON c.id = li.copy_id
   WHERE li.id = p_loan_item_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: loan item';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
  SELECT id INTO v_locked FROM loans WHERE id = v_loan FOR UPDATE;
  SELECT status INTO v_status FROM loan_items WHERE id = p_loan_item_id FOR UPDATE;
  IF v_status <> 'on_loan' THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: loan item is ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  UPDATE loan_items SET status = 'lost', lost_declared_at = p_now WHERE id = p_loan_item_id;
  CALL sp__assess_fines(p_loan_item_id, p_actor_user_id, p_now, 'lost', NULL, p_lost_fine_vnd, p_reason);
  UPDATE book_copies SET circulation_status = 'lost', updated_at = p_now WHERE id = v_copy;
  IF NOT EXISTS (SELECT 1 FROM loan_items WHERE loan_id = v_loan AND status = 'on_loan') THEN
    UPDATE loans SET status = 'closed' WHERE id = v_loan;
  END IF;
  COMMIT;

  SELECT id AS fine_id, fine_type, assessed_amount_vnd FROM fines
   WHERE loan_item_id = p_loan_item_id ORDER BY id;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_expire_cards` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_expire_cards`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  OUT p_count INT)
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_expire_holds` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_expire_holds`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  OUT p_count INT)
    COMMENT '[Ext] Expire overdue holds on demand; the event ev_expire_holds runs the same batch'
BEGIN
  IF NOT fn_has_permission(p_actor_user_id, 'reservation.manage') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required';
  END IF;
  CALL sp__expire_holds_batch(p_now, p_count);
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_issue_card` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_issue_card`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_card_number VARCHAR(32),
  IN p_expires_at DATETIME(3),
  OUT p_card_id BIGINT)
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_record_payment` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_record_payment`(
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
    CALL sp__check_replay(p_payment_id, p_reader_id, p_amount_vnd, p_allocations);
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

  -- 1. Replay: the same request key and payload returns the existing payment, with no writes (R-16e);
  --    the same key with a different payload is IDEMPOTENCY_CONFLICT.
  SELECT id INTO v_existing FROM fine_payments WHERE request_key = p_request_key;
  IF v_existing IS NOT NULL THEN
    CALL sp__check_replay(v_existing, p_reader_id, p_amount_vnd, p_allocations);
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_register_copy` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_register_copy`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_book_id BIGINT,
  IN p_barcode VARCHAR(32),
  IN p_shelf_code VARCHAR(50),
  IN p_acquired_at DATE,
  IN p_condition VARCHAR(16),
  OUT p_copy_id BIGINT)
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
  -- [Ext] A new lendable copy goes to the book's queue first (FR-014b).
  IF p_condition <> 'damaged' THEN
    CALL sp__promote_queue(p_copy_id, p_actor_user_id, p_now);
  END IF;
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_renew` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_renew`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  OUT p_new_due_at DATETIME(3))
    COMMENT 'Extend a loan item by its applied loan days; records the renewal'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_due DATETIME(3);
  DECLARE v_count SMALLINT;
  DECLARE v_max SMALLINT;
  DECLARE v_days SMALLINT;
  DECLARE v_waiting INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.renew') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.renew required';
  END IF;

  START TRANSACTION;
  SELECT l.reader_id, c.book_id INTO v_reader, v_book
    FROM loan_items li JOIN loans l ON l.id = li.loan_id JOIN book_copies c ON c.id = li.copy_id
   WHERE li.id = p_loan_item_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: loan item';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT status, due_at, renewal_count, applied_max_renewals, applied_loan_days
    INTO v_status, v_due, v_count, v_max, v_days
    FROM loan_items WHERE id = p_loan_item_id FOR UPDATE;

  IF v_status <> 'on_loan' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: not_on_loan';
  END IF;
  IF v_due < p_now THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: overdue';
  END IF;
  IF v_count >= v_max THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: limit';
  END IF;
  -- [Ext] a waiting reservation for the book blocks renewal (trivially none while reservations are not built).
  SELECT COUNT(*) INTO v_waiting FROM reservations WHERE book_id = v_book AND status = 'waiting' FOR SHARE;
  IF v_waiting > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RENEWAL_REJECTED: reserved';
  END IF;

  SET p_new_due_at = v_due + INTERVAL v_days DAY;
  UPDATE loan_items SET due_at = p_new_due_at, renewal_count = renewal_count + 1 WHERE id = p_loan_item_id;
  INSERT INTO loan_renewals (loan_item_id, old_due_at, new_due_at, renewed_at, performed_by_user_id)
  VALUES (p_loan_item_id, v_due, p_new_due_at, p_now, p_actor_user_id);
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_report_cumulative` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_report_cumulative`(IN p_as_of DATETIME(3), IN p_reader_id BIGINT)
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_report_rollforward` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_report_rollforward`(IN p_from DATETIME(3), IN p_to DATETIME(3), IN p_reader_id BIGINT)
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_reserve` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_reserve`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_reader_id BIGINT,
  IN p_book_id BIGINT,
  OUT p_reservation_id BIGINT)
    COMMENT '[Ext] Reserve a book: only when no copy is available and the reader has none on loan (D6)'
BEGIN
  DECLARE v_locked BIGINT;
  DECLARE v_available INT DEFAULT 0;
  DECLARE v_on_loan INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  -- Staff with reservation.manage, or the reader's own active account.
  IF NOT fn_has_permission(p_actor_user_id, 'reservation.manage')
     AND NOT EXISTS (SELECT 1 FROM readers r JOIN app_users u ON u.id = r.user_id
                      WHERE r.id = p_reader_id AND u.id = p_actor_user_id AND u.status = 'active') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: reservation.manage required, or reserve for yourself';
  END IF;

  START TRANSACTION;
  SELECT id INTO v_locked FROM readers WHERE id = p_reader_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: reader';
  END IF;
  SET v_locked = NULL;
  SELECT id INTO v_locked FROM books WHERE id = p_book_id FOR UPDATE;
  IF v_locked IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: book';
  END IF;
  SELECT COUNT(*) INTO v_available FROM book_copies
   WHERE book_id = p_book_id AND circulation_status = 'available' FOR SHARE;
  IF v_available > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: the book has an available copy; borrow it instead';
  END IF;
  SELECT COUNT(*) INTO v_on_loan
    FROM loans l JOIN loan_items li ON li.loan_id = l.id JOIN book_copies c ON c.id = li.copy_id
   WHERE l.reader_id = p_reader_id AND li.status = 'on_loan' AND c.book_id = p_book_id FOR SHARE;
  IF v_on_loan > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: the reader already has this book on loan';
  END IF;

  -- A second waiting/ready reservation for (reader, book) fails on reservations_active_uq (R-14a).
  INSERT INTO reservations (reader_id, book_id, requested_at, status)
  VALUES (p_reader_id, p_book_id, p_now, 'waiting');
  SET p_reservation_id = LAST_INSERT_ID();
  COMMIT;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_return_item` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_return_item`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_loan_item_id BIGINT,
  IN p_return_condition VARCHAR(16),
  IN p_damaged_fine_vnd BIGINT,
  IN p_reason VARCHAR(500))
    COMMENT 'Receive a returned copy, assess fines, release the copy; returns the assessed fines'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_loan BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_msg VARCHAR(128);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF NOT fn_has_permission(p_actor_user_id, 'loan.return') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: loan.return required';
  END IF;
  IF p_return_condition IS NULL OR p_return_condition NOT IN ('good', 'worn', 'damaged') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VALIDATION: return condition must be good, worn or damaged';
  END IF;

  START TRANSACTION;
  -- Immutable ids that decide the lock order.
  SELECT l.reader_id, c.book_id, li.copy_id, li.loan_id INTO v_reader, v_book, v_copy, v_loan
    FROM loan_items li JOIN loans l ON l.id = li.loan_id JOIN book_copies c ON c.id = li.copy_id
   WHERE li.id = p_loan_item_id;
  IF v_reader IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: loan item';
  END IF;
  SELECT id INTO v_locked FROM readers WHERE id = v_reader FOR UPDATE;
  SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
  SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
  SELECT id INTO v_locked FROM loans WHERE id = v_loan FOR UPDATE;
  SELECT status INTO v_status FROM loan_items WHERE id = p_loan_item_id FOR UPDATE;
  IF v_status <> 'on_loan' THEN
    SET v_msg = CONCAT('INVALID_TRANSITION: loan item is ', v_status);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  UPDATE loan_items
     SET status = 'returned', returned_at = p_now, return_condition = p_return_condition
   WHERE id = p_loan_item_id;
  CALL sp__assess_fines(p_loan_item_id, p_actor_user_id, p_now,
                        IF(p_return_condition = 'damaged', 'returned_damaged', 'returned'),
                        p_damaged_fine_vnd, NULL, p_reason);
  IF p_return_condition = 'damaged' THEN
    UPDATE book_copies SET physical_condition = 'damaged', circulation_status = 'in_repair', updated_at = p_now
     WHERE id = v_copy;
  ELSE
    UPDATE book_copies SET physical_condition = p_return_condition, circulation_status = 'available', updated_at = p_now
     WHERE id = v_copy;
    -- [Ext] The book's waiting reservations are locked last (global order) and get the copy first.
    CALL sp__promote_queue(v_copy, p_actor_user_id, p_now);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM loan_items WHERE loan_id = v_loan AND status = 'on_loan') THEN
    UPDATE loans SET status = 'closed' WHERE id = v_loan;
  END IF;
  COMMIT;

  SELECT id AS fine_id, fine_type, assessed_amount_vnd FROM fines
   WHERE loan_item_id = p_loan_item_id ORDER BY id;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp_set_card_status` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp_set_card_status`(
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_card_id BIGINT,
  IN p_status VARCHAR(16))
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
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp__assess_fines` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp__assess_fines`(
  IN p_loan_item_id BIGINT,
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3),
  IN p_end_kind VARCHAR(20),          -- 'returned' | 'returned_damaged' | 'lost'
  IN p_damaged_vnd BIGINT,
  IN p_lost_vnd BIGINT,
  IN p_reason VARCHAR(500))
    COMMENT 'Internal: assess late / damaged / lost fines for one loan item (FR-015a/b)'
BEGIN
  DECLARE v_due DATETIME(3);
  DECLARE v_fee BIGINT;
  DECLARE v_cost BIGINT;
  DECLARE v_days INT;
  DECLARE v_late BIGINT;
  DECLARE v_lost BIGINT;
  DECLARE v_blank BOOLEAN;

  SELECT li.due_at, li.applied_daily_fee_vnd, b.replacement_cost_vnd INTO v_due, v_fee, v_cost
    FROM loan_items li
    JOIN book_copies c ON c.id = li.copy_id
    JOIN books b ON b.id = c.book_id
   WHERE li.id = p_loan_item_id;
  SET v_blank = (p_reason IS NULL OR CHAR_LENGTH(TRIM(p_reason)) = 0);

  -- Late fine: whole local days to the end event (return or lost declaration), capped (D2).
  SET v_days = fn_days_late(v_due, p_now);
  IF v_days > 0 THEN
    SET v_late = fn_late_fee(v_days, v_fee, v_cost);
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'late', v_late, v_late, NULL, p_now, p_actor_user_id);
  END IF;

  -- Damaged fine: librarian-entered, 0…replacement cost, reason required (D3).
  IF p_end_kind = 'returned_damaged' THEN
    IF p_damaged_vnd IS NULL OR p_damaged_vnd < 0 OR (v_cost IS NOT NULL AND p_damaged_vnd > v_cost) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: damaged fine must be between 0 and the replacement cost';
    END IF;
    IF v_blank THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a damaged fine needs a reason';
    END IF;
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'damaged', 0, p_damaged_vnd, p_reason, p_now, p_actor_user_id);
  END IF;

  -- Lost fine: default = replacement cost; an override or an unknown cost needs a reason.
  IF p_end_kind = 'lost' THEN
    IF v_cost IS NULL AND (p_lost_vnd IS NULL OR v_blank) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: replacement cost unknown; enter a lost fine and a reason';
    END IF;
    IF p_lost_vnd IS NOT NULL AND p_lost_vnd < 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: lost fine cannot be negative';
    END IF;
    SET v_lost = COALESCE(p_lost_vnd, v_cost);
    IF v_lost <> COALESCE(v_cost, -1) AND v_blank THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FINE_RULE: a lost fine different from the replacement cost needs a reason';
    END IF;
    INSERT INTO fines (loan_item_id, fine_type, default_amount_vnd, assessed_amount_vnd, reason, assessed_at, assessed_by_user_id)
    VALUES (p_loan_item_id, 'lost', COALESCE(v_cost, 0), v_lost, IF(v_blank, NULL, p_reason), p_now, p_actor_user_id);
  END IF;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp__check_replay` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp__check_replay`(
  IN p_payment_id BIGINT,
  IN p_reader_id BIGINT,
  IN p_amount_vnd BIGINT,
  IN p_allocations JSON)
    COMMENT 'Internal: a replayed request key must carry the same reader, amount and allocations'
BEGIN
  DECLARE v_reader BIGINT;
  DECLARE v_amount BIGINT;
  DECLARE v_stored INT DEFAULT 0;
  DECLARE v_matched INT DEFAULT 0;
  DECLARE v_distinct INT DEFAULT 0;

  SELECT reader_id, amount_vnd INTO v_reader, v_amount FROM fine_payments WHERE id = p_payment_id;
  IF NOT (v_reader <=> p_reader_id) OR NOT (v_amount <=> p_amount_vnd)
     OR p_allocations IS NULL OR JSON_TYPE(p_allocations) <> 'ARRAY' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IDEMPOTENCY_CONFLICT: request key already used for a different payment';
  END IF;
  SELECT COUNT(*) INTO v_stored FROM fine_payment_allocations WHERE payment_id = p_payment_id;
  SELECT COUNT(*), COUNT(DISTINCT j.fine_id) INTO v_matched, v_distinct
    FROM JSON_TABLE(p_allocations, '$[*]' COLUMNS (
           fine_id BIGINT PATH '$.fine_id' NULL ON EMPTY,
           amount_vnd BIGINT PATH '$.amount_vnd' NULL ON EMPTY)) AS j
    JOIN fine_payment_allocations a
      ON a.payment_id = p_payment_id AND a.fine_id = j.fine_id AND a.amount_vnd = j.amount_vnd;
  IF v_matched <> v_stored OR v_distinct <> v_stored OR JSON_LENGTH(p_allocations) <> v_stored THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IDEMPOTENCY_CONFLICT: request key already used for a different payment';
  END IF;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp__expire_holds_batch` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp__expire_holds_batch`(
  IN p_now DATETIME(3),
  OUT p_count INT)
    COMMENT 'Internal [Ext]: expire every ready hold past its expiry, one transaction per hold (cursor)'
BEGIN
  DECLARE v_done BOOLEAN DEFAULT FALSE;
  DECLARE v_res BIGINT;
  DECLARE v_book BIGINT;
  DECLARE v_copy BIGINT;
  DECLARE v_locked BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_until DATETIME(3);
  DECLARE c_holds CURSOR FOR
    SELECT id, book_id, assigned_copy_id FROM reservations
     WHERE status = 'ready' AND hold_expires_at <= p_now
     ORDER BY book_id, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET p_count = 0;
  OPEN c_holds;
  expire: LOOP
    FETCH c_holds INTO v_res, v_book, v_copy;
    IF v_done THEN
      LEAVE expire;
    END IF;
    START TRANSACTION;
    SELECT id INTO v_locked FROM books WHERE id = v_book FOR UPDATE;
    SELECT id INTO v_locked FROM book_copies WHERE id = v_copy FOR UPDATE;
    -- Re-check under the locks: a checkout or cancel may have closed it since the cursor read it.
    SELECT status, hold_expires_at INTO v_status, v_until FROM reservations WHERE id = v_res FOR UPDATE;
    IF v_status = 'ready' AND v_until <= p_now THEN
      UPDATE reservations
         SET status = 'expired', closed_at = p_now, closed_by_kind = 'system', close_reason = 'hold_expired'
       WHERE id = v_res;
      CALL sp__promote_queue(v_copy, NULL, p_now);
      SET p_count = p_count + 1;
    END IF;
    COMMIT;
    SET v_done = FALSE;
  END LOOP;
  CLOSE c_holds;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sp__promote_queue` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`%` PROCEDURE `sp__promote_queue`(
  IN p_copy_id BIGINT,
  IN p_actor_user_id BIGINT,
  IN p_now DATETIME(3))
    COMMENT 'Internal [Ext]: give a lendable copy to the first eligible waiting reservation, else make it available'
BEGIN
  -- FR-014b. The caller holds the book and copy locks, and the copy is lendable (good or worn):
  -- just returned, registered, repaired, found, or its hold just ended.
  DECLARE v_book BIGINT;
  DECLARE v_status VARCHAR(16);
  DECLARE v_waiting INT DEFAULT 0;
  DECLARE v_res BIGINT;
  DECLARE v_reader BIGINT;
  DECLARE v_reader_status VARCHAR(16);
  DECLARE v_cards INT DEFAULT 0;
  DECLARE v_none BOOLEAN DEFAULT FALSE;
  -- A SELECT … INTO that finds no row must not reach a caller's NOT FOUND handler (cursor loops).
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_none = TRUE;

  SELECT book_id, circulation_status INTO v_book, v_status FROM book_copies WHERE id = p_copy_id;
  -- Lock the whole queue in queue order (last in the global lock order).
  SELECT COUNT(*) INTO v_waiting FROM reservations
   WHERE book_id = v_book AND status = 'waiting' FOR UPDATE; -- scans reservations_queue_ix in queue order

  promote: LOOP
    SET v_none = FALSE, v_res = NULL;
    SELECT id, reader_id INTO v_res, v_reader FROM reservations
     WHERE book_id = v_book AND status = 'waiting' ORDER BY requested_at, id LIMIT 1 FOR UPDATE;
    IF v_none OR v_res IS NULL THEN
      IF v_status <> 'available' THEN
        UPDATE book_copies SET circulation_status = 'available', updated_at = p_now WHERE id = p_copy_id;
      END IF;
      LEAVE promote;
    END IF;
    -- Hard eligibility (D4). Plain reads: readers and cards come before books in the lock order,
    -- and checkout re-checks the holder under its own locks, so a stale answer can only give a
    -- hold that later expires, never a loan.
    SET v_reader_status = NULL;
    SELECT status INTO v_reader_status FROM readers WHERE id = v_reader;
    SELECT COUNT(*) INTO v_cards FROM library_cards
     WHERE reader_id = v_reader AND status = 'active' AND expires_at > p_now;
    IF v_reader_status = 'active' AND v_cards > 0 THEN
      IF v_status <> 'on_hold' THEN
        UPDATE book_copies SET circulation_status = 'on_hold', updated_at = p_now WHERE id = p_copy_id;
      END IF;
      UPDATE reservations
         SET status = 'ready', assigned_copy_id = p_copy_id, ready_at = p_now,
             hold_expires_at = p_now + INTERVAL 3 DAY
       WHERE id = v_res;
      LEAVE promote;
    END IF;
    UPDATE reservations
       SET status = 'cancelled', close_reason = 'ineligible_at_promotion', closed_by_kind = 'system',
           closed_at = p_now
     WHERE id = v_res;
  END LOOP;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50001 DROP VIEW IF EXISTS `v_inv_borrow_in_policy`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_borrow_in_policy` AS select `li`.`id` AS `loan_item_id`,`li`.`borrowed_at` AS `borrowed_at`,`p`.`id` AS `policy_id`,`p`.`valid_from` AS `valid_from`,`p`.`valid_to` AS `valid_to`,'loan item borrow time is outside its policy version period' AS `problem` from (`loan_items` `li` join `loan_policies` `p` on((`p`.`id` = `li`.`policy_id`))) where ((`li`.`borrowed_at` < `p`.`valid_from`) or ((`p`.`valid_to` is not null) and (`li`.`borrowed_at` >= `p`.`valid_to`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_cards_policies`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_cards_policies` AS select `lc`.`reader_id` AS `subject_id`,NULL AS `other_id`,'reader has more than one active card' AS `problem` from `library_cards` `lc` where (`lc`.`status` = 'active') group by `lc`.`reader_id` having (count(0) > 1) union all select `a`.`id` AS `id`,`b`.`id` AS `id`,'overlapping loan policy versions for one pair' AS `problem` from (`loan_policies` `a` join `loan_policies` `b` on(((`b`.`reader_type_id` = `a`.`reader_type_id`) and (`b`.`material_type_id` = `a`.`material_type_id`) and (`b`.`id` > `a`.`id`)))) where ((`a`.`valid_from` < coalesce(`b`.`valid_to`,'9999-12-31 23:59:59.999')) and (`b`.`valid_from` < coalesce(`a`.`valid_to`,'9999-12-31 23:59:59.999'))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_copy_on_hold`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_copy_on_hold` AS select `c`.`id` AS `copy_id`,`c`.`circulation_status` AS `circulation_status`,count(`r`.`id`) AS `ready_reservations`,'copy on_hold status disagrees with its ready reservations' AS `problem` from (`book_copies` `c` left join `reservations` `r` on(((`r`.`assigned_copy_id` = `c`.`id`) and (`r`.`status` = 'ready')))) group by `c`.`id`,`c`.`circulation_status` having (((`c`.`circulation_status` = 'on_hold') <> (count(`r`.`id`) = 1)) or (count(`r`.`id`) > 1)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_copy_on_loan`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_copy_on_loan` AS select `c`.`id` AS `copy_id`,`c`.`circulation_status` AS `circulation_status`,count(`li`.`id`) AS `open_items`,'copy on_loan status disagrees with its on_loan loan items' AS `problem` from (`book_copies` `c` left join `loan_items` `li` on(((`li`.`copy_id` = `c`.`id`) and (`li`.`status` = 'on_loan')))) group by `c`.`id`,`c`.`circulation_status` having (((`c`.`circulation_status` = 'on_loan') <> (count(`li`.`id`) = 1)) or (count(`li`.`id`) > 1)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_damaged_lendable`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_damaged_lendable` AS select `c`.`id` AS `copy_id`,`c`.`physical_condition` AS `physical_condition`,`c`.`circulation_status` AS `circulation_status`,'damaged copy is lendable' AS `problem` from `book_copies` `c` where ((`c`.`physical_condition` = 'damaged') and (`c`.`circulation_status` in ('available','on_hold','on_loan'))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_fine_balance`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_fine_balance` AS select `f`.`id` AS `fine_id`,`n`.`net_vnd` AS `net_vnd`,`n`.`allocated_vnd` AS `allocated_vnd`,'fine allocated amount is negative or exceeds its net amount' AS `problem` from (`fines` `f` join (select `f2`.`id` AS `id`,(`f2`.`assessed_amount_vnd` + coalesce((select sum(`a`.`amount_vnd`) from `fine_adjustments` `a` where (`a`.`fine_id` = `f2`.`id`)),0)) AS `net_vnd`,coalesce((select sum(`x`.`amount_vnd`) from `fine_payment_allocations` `x` where (`x`.`fine_id` = `f2`.`id`)),0) AS `allocated_vnd` from `fines` `f2`) `n` on((`n`.`id` = `f`.`id`))) where ((`n`.`allocated_vnd` < 0) or (`n`.`allocated_vnd` > `n`.`net_vnd`) or (`n`.`net_vnd` < 0)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_loan_status`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_loan_status` AS select `l`.`id` AS `loan_id`,`l`.`status` AS `status`,count(`li`.`id`) AS `items`,sum((`li`.`status` = 'on_loan')) AS `open_items`,'loan status disagrees with its items (or loan has no items)' AS `problem` from (`loans` `l` left join `loan_items` `li` on((`li`.`loan_id` = `l`.`id`))) group by `l`.`id`,`l`.`status` having ((count(`li`.`id`) = 0) or ((`l`.`status` = 'open') <> (coalesce(sum((`li`.`status` = 'on_loan')),0) > 0))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_payment_allocation`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_payment_allocation` AS select `p`.`id` AS `payment_id`,`p`.`amount_vnd` AS `amount_vnd`,coalesce(sum(`x`.`amount_vnd`),0) AS `allocated_vnd`,'payment allocations do not sum to the payment amount' AS `problem` from (`fine_payments` `p` left join `fine_payment_allocations` `x` on((`x`.`payment_id` = `p`.`id`))) group by `p`.`id`,`p`.`amount_vnd` having (coalesce(sum(`x`.`amount_vnd`),0) <> `p`.`amount_vnd`) union all select `p`.`id` AS `id`,`p`.`amount_vnd` AS `amount_vnd`,`x`.`amount_vnd` AS `amount_vnd`,'allocation pays a fine of another reader' AS `problem` from ((((`fine_payments` `p` join `fine_payment_allocations` `x` on((`x`.`payment_id` = `p`.`id`))) join `fines` `f` on((`f`.`id` = `x`.`fine_id`))) join `loan_items` `li` on((`li`.`id` = `f`.`loan_item_id`))) join `loans` `l` on((`l`.`id` = `li`.`loan_id`))) where (`l`.`reader_id` <> `p`.`reader_id`) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_inv_queue_available`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_inv_queue_available` AS select distinct `r`.`book_id` AS `book_id`,`c`.`id` AS `available_copy_id`,'book has a waiting reservation and an available copy' AS `problem` from (`reservations` `r` join `book_copies` `c` on(((`c`.`book_id` = `r`.`book_id`) and (`c`.`circulation_status` = 'available')))) where (`r`.`status` = 'waiting') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_report_copy_status`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_report_copy_status` AS select `b`.`id` AS `book_id`,`b`.`title` AS `title`,sum((`c`.`circulation_status` = 'available')) AS `available`,sum((`c`.`circulation_status` = 'on_loan')) AS `on_loan`,sum((`c`.`circulation_status` = 'on_hold')) AS `on_hold`,sum((`c`.`circulation_status` = 'in_repair')) AS `in_repair`,sum((`c`.`circulation_status` = 'lost')) AS `lost`,sum((`c`.`circulation_status` = 'retired')) AS `retired`,count(`c`.`id`) AS `total` from (`books` `b` join `book_copies` `c` on((`c`.`book_id` = `b`.`id`))) group by `b`.`id`,`b`.`title` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_report_loans_by_month`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_report_loans_by_month` AS select date_format(`fn_local_date`(`l`.`borrowed_at`),'%Y-%m') AS `month_local`,`rt`.`code` AS `reader_type`,count(distinct `l`.`id`) AS `loans`,count(`li`.`id`) AS `items` from (((`loans` `l` join `readers` `r` on((`r`.`id` = `l`.`reader_id`))) join `reader_types` `rt` on((`rt`.`id` = `r`.`reader_type_id`))) join `loan_items` `li` on((`li`.`loan_id` = `l`.`id`))) group by date_format(`fn_local_date`(`l`.`borrowed_at`),'%Y-%m'),`rt`.`code` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_report_overdue`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_report_overdue` AS select `r`.`id` AS `reader_id`,`r`.`full_name` AS `full_name`,`b`.`title` AS `title`,`c`.`barcode` AS `barcode`,`li`.`id` AS `loan_item_id`,`li`.`due_at` AS `due_at`,`fn_days_late`(`li`.`due_at`,utc_timestamp(3)) AS `days_late` from ((((`loan_items` `li` join `loans` `l` on((`l`.`id` = `li`.`loan_id`))) join `readers` `r` on((`r`.`id` = `l`.`reader_id`))) join `book_copies` `c` on((`c`.`id` = `li`.`copy_id`))) join `books` `b` on((`b`.`id` = `c`.`book_id`))) where ((`li`.`status` = 'on_loan') and (`li`.`due_at` < utc_timestamp(3))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!50001 DROP VIEW IF EXISTS `v_report_popular_books`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_report_popular_books` AS select `b`.`id` AS `book_id`,`b`.`title` AS `title`,count(`li`.`id`) AS `loan_items` from ((`books` `b` join `book_copies` `c` on((`c`.`book_id` = `b`.`id`))) join `loan_items` `li` on((`li`.`copy_id` = `c`.`id`))) group by `b`.`id`,`b`.`title` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

