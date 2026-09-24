-- Reference data (tasks T025, data-model.md). Seeded by the owner; the app account cannot change it.
INSERT INTO `material_types` (`code`, `name`) VALUES ('BOOK_PRINT', 'Printed book');
--> statement-breakpoint
INSERT INTO `reader_types` (`code`, `name`) VALUES
  ('STUDENT', 'Student'),
  ('LECTURER', 'Lecturer'),
  ('EXTERNAL', 'External reader');
--> statement-breakpoint
INSERT INTO `permissions` (`code`, `description`) VALUES
  ('catalog.write', 'Create and edit books and copies'),
  ('catalog.import', 'Import book metadata from external providers'),
  ('card.manage', 'Issue and change library cards'),
  ('loan.checkout', 'Lend copies to readers'),
  ('loan.return', 'Receive returned copies and declare losses'),
  ('loan.renew', 'Extend due dates'),
  ('fine.collect', 'Record fine payments'),
  ('fine.adjust', 'Correct assessed fines with an audited adjustment'),
  ('policy.manage', 'Create and close loan policy versions'),
  ('role.manage', 'Assign roles to accounts'),
  ('report.read', 'Read circulation and debt reports'),
  ('reservation.manage', 'Create and cancel reservations for readers');
--> statement-breakpoint
INSERT INTO `roles` (`code`, `name`) VALUES
  ('admin', 'Administrator'),
  ('librarian', 'Librarian'),
  ('reader', 'Reader');
--> statement-breakpoint
-- admin: every permission
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `roles` r CROSS JOIN `permissions` p WHERE r.code = 'admin';
--> statement-breakpoint
-- librarian: everything except policy and role management; reader: none
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id FROM `roles` r CROSS JOIN `permissions` p
 WHERE r.code = 'librarian' AND p.code NOT IN ('policy.manage', 'role.manage');
