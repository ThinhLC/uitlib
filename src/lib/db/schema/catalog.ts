import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { big, id, ts } from './common';

// Catalog tables (data-model.md "Catalog"). CHECK expressions use raw column names (S0 results).

/** A kind of library material. */
export const materialTypes = mysqlTable('material_types', {
  id: id(),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
}, (t) => [uniqueIndex('material_types_code_uq').on(t.code)]);

/** An organisation that publishes editions. */
export const publishers = mysqlTable('publishers', {
  id: id(),
  name: varchar('name', { length: 255 }).notNull(),
}, (t) => [index('publishers_name_ix').on(t.name)]);

/** A person or organisation credited on books. */
export const authors = mysqlTable('authors', {
  id: id(),
  name: varchar('name', { length: 255 }).notNull(),
}, (t) => [index('authors_name_ix').on(t.name)]);

/** A subject category, optionally under a parent. */
export const categories = mysqlTable('categories', {
  id: id(),
  name: varchar('name', { length: 150 }).notNull(),
  parentId: big('parent_id'),
}, (t) => [
  uniqueIndex('categories_parent_name_uq').on(t.parentId, t.name),
  foreignKey({ name: 'categories_parent_fk', columns: [t.parentId], foreignColumns: [t.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Book `id` is one catalogued edition owned by the library. */
export const books = mysqlTable('books', {
  id: id(),
  title: varchar('title', { length: 500 }).notNull(),
  subtitle: varchar('subtitle', { length: 500 }),
  publisherId: big('publisher_id'),
  publishedDateText: varchar('published_date_text', { length: 10 }),
  publishedYear: smallint('published_year'),
  description: text('description'),
  languageCode: varchar('language_code', { length: 8 }),
  coverUrl: varchar('cover_url', { length: 1000 }),
  materialTypeId: big('material_type_id').notNull(),
  classificationCode: varchar('classification_code', { length: 50 }),
  replacementCostVnd: big('replacement_cost_vnd'),
  status: mysqlEnum('status', ['active', 'retired']).notNull().default('active'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [
  foreignKey({ name: 'books_publisher_fk', columns: [t.publisherId], foreignColumns: [publishers.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'books_material_type_fk', columns: [t.materialTypeId], foreignColumns: [materialTypes.id] })
    .onDelete('restrict').onUpdate('restrict'),
  check('books_published_year_ck', sql`published_year IS NULL OR published_year BETWEEN 1000 AND 2100`),
  check('books_replacement_cost_ck', sql`replacement_cost_vnd IS NULL OR replacement_cost_vnd >= 0`),
  index('books_title_ix').on(t.title),
  index('books_published_year_ix').on(t.publishedYear),
]);

/** Book `book_id` is credited to author `author_id` in position `author_order` (junction). */
export const bookAuthors = mysqlTable('book_authors', {
  bookId: big('book_id').notNull(),
  authorId: big('author_id').notNull(),
  authorOrder: tinyint('author_order', { unsigned: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.bookId, t.authorId] }),
  uniqueIndex('book_authors_order_uq').on(t.bookId, t.authorOrder),
  index('book_authors_author_ix').on(t.authorId),
  check('book_authors_order_ck', sql`author_order >= 1`),
  foreignKey({ name: 'book_authors_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'book_authors_author_fk', columns: [t.authorId], foreignColumns: [authors.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Book `book_id` is classified in category `category_id` (junction). */
export const bookCategories = mysqlTable('book_categories', {
  bookId: big('book_id').notNull(),
  categoryId: big('category_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.bookId, t.categoryId] }),
  index('book_categories_category_ix').on(t.categoryId),
  foreignKey({ name: 'book_categories_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
  foreignKey({ name: 'book_categories_category_fk', columns: [t.categoryId], foreignColumns: [categories.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Book `book_id` carries identifier (type, value); not globally unique (FR-003). */
export const bookIdentifiers = mysqlTable('book_identifiers', {
  id: id(),
  bookId: big('book_id').notNull(),
  identifierType: mysqlEnum('identifier_type', ['ISBN_10', 'ISBN_13', 'OTHER']).notNull(),
  identifierValue: varchar('identifier_value', { length: 64 }).notNull(),
}, (t) => [
  uniqueIndex('book_identifiers_uq').on(t.bookId, t.identifierType, t.identifierValue),
  index('book_identifiers_value_ix').on(t.identifierType, t.identifierValue),
  foreignKey({ name: 'book_identifiers_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Book `book_id` was sourced from provider record `external_id`, snapshot fetched at `fetched_at`. */
export const bookExternalRefs = mysqlTable('book_external_refs', {
  id: id(),
  bookId: big('book_id').notNull(),
  provider: mysqlEnum('provider', ['GOOGLE_BOOKS']).notNull(),
  externalId: varchar('external_id', { length: 64 }).notNull(),
  sourceUrl: varchar('source_url', { length: 1000 }),
  viewability: mysqlEnum('viewability', ['PARTIAL', 'ALL_PAGES', 'NO_PAGES', 'UNKNOWN']),
  embeddable: boolean('embeddable'),
  webReaderLink: varchar('web_reader_link', { length: 1000 }),
  accessCountry: char('access_country', { length: 2 }),
  rawSnapshot: json('raw_snapshot').notNull(),
  fetchedAt: ts('fetched_at').notNull(),
}, (t) => [
  uniqueIndex('book_external_refs_provider_uq').on(t.provider, t.externalId),
  index('book_external_refs_book_ix').on(t.bookId),
  foreignKey({ name: 'book_external_refs_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);

/** Copy `barcode` is one physical item of book `book_id`. */
export const bookCopies = mysqlTable('book_copies', {
  id: id(),
  bookId: big('book_id').notNull(),
  barcode: varchar('barcode', { length: 32 }).notNull(),
  shelfCode: varchar('shelf_code', { length: 50 }),
  acquiredAt: date('acquired_at', { mode: 'string' }),
  physicalCondition: mysqlEnum('physical_condition', ['good', 'worn', 'damaged']).notNull(),
  circulationStatus: mysqlEnum('circulation_status',
    ['available', 'on_loan', 'on_hold', 'in_repair', 'lost', 'retired']).notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [
  uniqueIndex('book_copies_barcode_uq').on(t.barcode),
  uniqueIndex('book_copies_id_book_uq').on(t.id, t.bookId),
  index('book_copies_book_status_ix').on(t.bookId, t.circulationStatus),
  check('book_copies_damaged_not_lendable_ck',
    sql`NOT (physical_condition = 'damaged' AND circulation_status IN ('available','on_hold','on_loan'))`),
  foreignKey({ name: 'book_copies_book_fk', columns: [t.bookId], foreignColumns: [books.id] })
    .onDelete('restrict').onUpdate('restrict'),
]);
