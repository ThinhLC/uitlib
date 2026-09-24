# ERD → relational mapping

This table maps every element of the conceptual ERD (`docs/erd/conceptual.puml`, Chen notation) to
relations of the relational schema (`docs/erd/relational.mmd`, generated from the migrated
database). Rules applied:

- **Strong entity** → a relation; the key attribute becomes the primary key (surrogate `id` plus
  a UNIQUE natural key where one exists).
- **1:N relationship** → a foreign key on the N side.
- **1:1 relationship** → a foreign key with a UNIQUE constraint.
- **M:N relationship** → a junction relation whose primary key is the pair of foreign keys;
  attributes of the relationship become columns of the junction.
- **Multi-valued attribute** → a separate relation with a foreign key to the owner.
- **Ternary relationship with (1,1) on one side** → foreign keys on that side.

## Entities

| ERD entity | Relation | Primary key | Natural key (UNIQUE) |
| --- | --- | --- | --- |
| MATERIAL_TYPE | `material_types` | `id` | `code` |
| PUBLISHER | `publishers` | `id` | — |
| AUTHOR | `authors` | `id` | — |
| CATEGORY | `categories` | `id` | (`parent_id`, `name`) |
| BOOK | `books` | `id` | — (identifiers are not globally unique, FR-003) |
| COPY | `book_copies` | `id` | `barcode` |
| EXTERNAL_REFERENCE | `book_external_refs` | `id` | (`provider`, `external_id`) |
| ACCOUNT | `app_users` | `id` | `supabase_user_id` |
| ROLE | `roles` | `id` | `code` |
| PERMISSION | `permissions` | `id` | `code` |
| READER_TYPE | `reader_types` | `id` | `code` |
| READER | `readers` | `id` | `user_id` (when linked) |
| LIBRARY_CARD | `library_cards` | `id` | `card_number` |
| LOAN_POLICY_VERSION | `loan_policies` | `id` | — (no overlap per pair, R-09a) |
| LOAN | `loans` | `id` | — |
| LOAN_ITEM | `loan_items` | `id` | — |
| RENEWAL | `loan_renewals` | `id` | — |
| RESERVATION | `reservations` | `id` | — |
| FINE | `fines` | `id` | (`loan_item_id`, `fine_type`) |
| FINE_ADJUSTMENT | `fine_adjustments` | `id` | — |
| PAYMENT | `fine_payments` | `id` | `request_key` |

## Relationships and multi-valued attributes

| ERD element | Kind | Relation(s) | Key / FK columns | Rule applied |
| --- | --- | --- | --- | --- |
| WRITTEN_BY (attr AuthorOrder) | M:N | `book_authors` | PK (`book_id`, `author_id`); `author_order` UNIQUE per book | junction |
| CLASSIFIED_IN | M:N | `book_categories` | PK (`book_id`, `category_id`) | junction |
| SUBCATEGORY_OF | 1:N (recursive) | `categories` | `parent_id` → `categories.id` (nullable) | FK on N side |
| PUBLISHED_BY | 1:N | `books` | `publisher_id` → `publishers.id` (nullable) | FK on N side |
| OF_TYPE | 1:N | `books` | `material_type_id` → `material_types.id` | FK on N side |
| HAS_COPY | 1:N | `book_copies` | `book_id` → `books.id` | FK on N side |
| SOURCED_FROM | 1:N | `book_external_refs` | `book_id` → `books.id` | FK on N side |
| Identifiers (multi-valued attribute of BOOK) | multi-valued | `book_identifiers` | `book_id` → `books.id`; UNIQUE (`book_id`, `identifier_type`, `identifier_value`) | separate relation |
| SIGNS_IN_AS | 1:1 | `readers` | `user_id` → `app_users.id`, UNIQUE, nullable | FK + UNIQUE |
| IS_OF_TYPE | 1:N | `readers` | `reader_type_id` → `reader_types.id` | FK on N side |
| HOLDS | 1:N | `library_cards` | `reader_id` → `readers.id` | FK on N side |
| HAS_ROLE | M:N | `user_roles` | PK (`user_id`, `role_id`) | junction |
| GRANTS | M:N | `role_permissions` | PK (`role_id`, `permission_id`) | junction |
| GOVERNS | ternary, (1,1) on POLICY_VERSION | `loan_policies` | `reader_type_id`, `material_type_id` | FKs on the (1,1) side |
| BORROWS | 1:N | `loans` | `reader_id` → `readers.id` | FK on N side |
| PROCESSES | 1:N | `loans` | `processed_by_user_id` → `app_users.id` | FK on N side |
| CONTAINS | 1:N | `loan_items` | `loan_id` → `loans.id` | FK on N side |
| LENDS | 1:N | `loan_items` | `copy_id` → `book_copies.id` | FK on N side |
| APPLIES | 1:N | `loan_items` | `policy_id` → `loan_policies.id` | FK on N side |
| EXTENDS | 1:N | `loan_renewals` | `loan_item_id` → `loan_items.id` | FK on N side |
| REQUESTS | ternary, (1,1) on RESERVATION | `reservations` | `reader_id`, `book_id` | FKs on the (1,1) side |
| HELD_AS | 1:N (optional) | `reservations` | (`assigned_copy_id`, `book_id`) → `book_copies`(`id`, `book_id`) | composite FK keeps the held copy in the reserved book |
| INCURS | 1:N | `fines` | `loan_item_id` → `loan_items.id` | FK on N side |
| CORRECTS | 1:N | `fine_adjustments` | `fine_id` → `fines.id` | FK on N side |
| PAYS | 1:N | `fine_payments` | `reader_id` → `readers.id` | FK on N side |
| SETTLES (attr AllocatedAmount) | M:N | `fine_payment_allocations` | PK (`payment_id`, `fine_id`); `amount_vnd` | junction |
| staff actions (who did it) | 1:N | `loan_policies`, `loan_renewals`, `fines`, `fine_adjustments`, `fine_payments`, `reservations` | `*_by_user_id` → `app_users.id` | FK on N side |

## Technical additions (not ERD elements)

| Relation | Column(s) | Why |
| --- | --- | --- |
| `library_cards` | `active_reader_id` (generated) | UNIQUE when active: at most one active card per reader (R-08c) |
| `loan_items` | `open_copy_id` (generated) | UNIQUE when on loan: at most one open loan item per copy (R-12a) |
| `reservations` | `active_flag` (generated) | UNIQUE (`reader_id`, `book_id`, `active_flag`): one waiting/ready reservation per reader and book (R-14a) |
| `reservations` | `ready_copy_id` (generated) | UNIQUE: a copy is held by at most one ready reservation (R-14d) |
| `loan_items` | `applied_loan_days`, `applied_max_renewals`, `applied_daily_fee_vnd` | snapshot of the policy at checkout, so history never changes (FR-011, R-11a) |
| `book_copies` | UNIQUE (`id`, `book_id`) | target of the `reservations` composite FK |
| all main entities | `created_at`, `updated_at` | audit timestamps (FR-023) |
| — | `__drizzle_migrations` | migration bookkeeping of the tooling, not part of the model |
