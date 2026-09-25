import { z } from 'zod';
import { distinct, Id, type Items, OptionalText, type Page, PageQuery } from './common';
import { defineEndpoint } from './endpoint';
import type { Copy } from './resources';

/*
 * Contract: US3 public catalog and catalog management (data-model.md "Public catalog" and
 * "Catalog management"). Where a quoted limit is wider than the spec 001 column, the column wins
 * (a longer value would fail in the database instead of in validation).
 */

// ---------------------------------------------------------------------------------------------
// Resources

export interface CatalogRef {
  id: number;
  name: string;
}

export type IdentifierType = 'ISBN_10' | 'ISBN_13' | 'OTHER';

/** A public list item. Only `active` books are public; no copy-level data (Clarification A1). */
export interface BookSummary {
  id: number;
  title: string;
  subtitle: string | null;
  /** By `author_order`. */
  authors: CatalogRef[];
  categories: CatalogRef[];
  publishedYear: number | null;
  languageCode: string | null;
  coverUrl: string | null;
  /** `material_types.code`, e.g. `BOOK_PRINT`. */
  materialType: string;
  /** `available`: copies `available`; `total`: copies neither `retired` nor `lost`. */
  copies: { available: number; total: number };
}

/** A public book page: no barcodes, shelf codes, replacement cost or external references. */
export interface BookDetail extends BookSummary {
  publisher: CatalogRef | null;
  publishedDateText: string | null;
  description: string | null;
  classificationCode: string | null;
  identifiers: { type: IdentifierType; value: string }[];
}

/** Staff view of a book (`catalog.write`). */
export interface BookAdmin extends BookDetail {
  replacementCostVnd: number | null;
  status: 'active' | 'retired';
}

export type Author = CatalogRef;
export type Publisher = CatalogRef;

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

// ---------------------------------------------------------------------------------------------
// Inputs

const Title = z.string().trim().min(1).max(500);
/** `https:` only. */
const CoverUrl = z.url({ protocol: /^https$/ }).max(1000);
/** Optional integer 0–9999 in data-model.md; the spec 001 CHECK `books_published_year_ck` allows 1000–2100. */
const PublishedYear = z.number().int().min(1000).max(2100);
/** BCP 47-like (`vi`, `en-US`); ≤ 16 chars in data-model.md, the column holds 8. */
const LanguageCode = z
  .string()
  .trim()
  .max(8)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, 'expected a language code like vi or en-US');
const MaterialTypeCode = z.string().trim().min(1).max(32);
const ReplacementCost = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Identifier = z.strictObject({
  type: z.enum(['ISBN_10', 'ISBN_13', 'OTHER']),
  value: z.string().trim().min(1).max(64),
});
/** Ordered array of existing author ids, 1–20, distinct (order becomes `author_order`). */
const AuthorIds = distinct(Id, 1, 20);
/** Array of existing category ids, 0–20, distinct. */
const CategoryIds = distinct(Id, 0, 20);
/** `{type: ISBN_10 | ISBN_13 | OTHER, value}`, 0–10, distinct per book. */
const Identifiers = distinct(Identifier, 0, 10);

/** Optional text an update may clear with `null` or `''`. */
const ClearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

/** Create a book (`POST /books`). */
export const BookInput = z.strictObject({
  title: Title,
  subtitle: OptionalText(500),
  description: OptionalText(16_000),
  publishedDateText: OptionalText(10),
  coverUrl: CoverUrl.optional(),
  classificationCode: OptionalText(50),
  publishedYear: PublishedYear.optional(),
  languageCode: LanguageCode.optional(),
  materialType: MaterialTypeCode,
  publisherId: Id.optional(),
  replacementCostVnd: ReplacementCost.optional(),
  authorIds: AuthorIds,
  categoryIds: CategoryIds.default([]),
  identifiers: Identifiers.default([]),
});
export type BookInput = z.output<typeof BookInput>;

/** Update a book (`PATCH /books/:bookId`): every field optional; arrays replace the stored set. */
export const BookUpdateInput = z.strictObject({
  title: Title.optional(),
  subtitle: ClearableText(500),
  description: ClearableText(16_000),
  publishedDateText: ClearableText(10),
  coverUrl: CoverUrl.nullable().optional(),
  classificationCode: ClearableText(50),
  publishedYear: PublishedYear.nullable().optional(),
  languageCode: LanguageCode.nullable().optional(),
  materialType: MaterialTypeCode.optional(),
  publisherId: Id.nullable().optional(),
  replacementCostVnd: ReplacementCost.nullable().optional(),
  authorIds: AuthorIds.optional(),
  categoryIds: CategoryIds.optional(),
  identifiers: Identifiers.optional(),
  status: z.enum(['active', 'retired']).optional(),
});
export type BookUpdateInput = z.output<typeof BookUpdateInput>;

/** `name` 1–200 (the authors column holds 255). */
export const AuthorInput = z.strictObject({ name: z.string().trim().min(1).max(200) });
export type AuthorInput = z.output<typeof AuthorInput>;

/** `name` 1–200 (the publishers column holds 255). */
export const PublisherInput = z.strictObject({ name: z.string().trim().min(1).max(200) });
export type PublisherInput = z.output<typeof PublisherInput>;

/** `name` 1–200 in data-model.md; the categories column holds 150. */
export const CategoryInput = z.strictObject({
  name: z.string().trim().min(1).max(150),
  parentId: Id.optional(),
});
export type CategoryInput = z.output<typeof CategoryInput>;

const Condition = z.enum(['good', 'worn', 'damaged']);

/** `sp_register_copy`: `barcode` 1–64 in data-model.md; the column and procedure hold 32. */
export const RegisterCopyInput = z.strictObject({
  barcode: z.string().trim().min(1).max(32),
  shelfCode: OptionalText(50),
  acquiredAt: z.iso.date().optional(),
  condition: Condition,
});
export type RegisterCopyInput = z.output<typeof RegisterCopyInput>;

/** `sp_change_copy_status`: maintenance statuses only. */
export const ChangeCopyStatusInput = z.strictObject({
  targetStatus: z.enum(['available', 'in_repair', 'retired']),
  condition: Condition,
});
export type ChangeCopyStatusInput = z.output<typeof ChangeCopyStatusInput>;

/** Public search (FR-015): text, category (with direct children), exact identifier, material type. */
export const CatalogSearchQuery = PageQuery.extend({
  q: z.string().trim().max(200).optional(),
  categoryId: Id.optional(),
  identifier: z.string().trim().min(1).max(64).optional(),
  materialType: MaterialTypeCode.optional(),
});
export type CatalogSearchQuery = z.output<typeof CatalogSearchQuery>;

/** Staff name lookup for authors and publishers: `LIKE` prefix. */
export const NameSearchQuery = PageQuery.extend({ q: z.string().trim().max(200).optional() });
export type NameSearchQuery = z.output<typeof NameSearchQuery>;

const BookIdParam = z.object({ bookId: Id });
const CopyIdParam = z.object({ copyId: Id });
const catalogWrite = { kind: 'perm', any: ['catalog.write'] } as const;

// ---------------------------------------------------------------------------------------------
// Endpoints

export const catalogEndpoints = {
  /** Search active books. Public. Errors: VALIDATION. */
  searchCatalog: defineEndpoint<Page<BookSummary>>()({
    method: 'GET',
    path: '/catalog/books',
    query: CatalogSearchQuery,
    access: { kind: 'public' },
    errors: [],
  }),
  /** One active book. Public. Errors: NOT_FOUND `book` (missing or retired). */
  getCatalogBook: defineEndpoint<BookDetail>()({
    method: 'GET',
    path: '/catalog/books/:bookId',
    params: BookIdParam,
    access: { kind: 'public' },
    errors: ['NOT_FOUND'],
  }),
  /** Every category, flat with `parentId`. Public. */
  listCategories: defineEndpoint<Items<Category>>()({
    method: 'GET',
    path: '/catalog/categories',
    access: { kind: 'public' },
    errors: [],
  }),
  /**
   * Create a book with its authors, categories and identifiers in one transaction. catalog.write.
   * Errors: FORBIDDEN, NOT_FOUND (`materialType`, `publisherId`, `authorIds`, `categoryIds`), DUPLICATE.
   */
  createBook: defineEndpoint<BookAdmin>()({
    method: 'POST',
    path: '/books',
    body: BookInput,
    access: catalogWrite,
    errors: ['FORBIDDEN', 'NOT_FOUND', 'DUPLICATE'],
  }),
  /** Staff view of any book (active or retired). catalog.write. Errors: FORBIDDEN, NOT_FOUND `book`. */
  getBook: defineEndpoint<BookAdmin>()({
    method: 'GET',
    path: '/books/:bookId',
    params: BookIdParam,
    access: catalogWrite,
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Update a book; given arrays replace the stored set, in one transaction. catalog.write.
   * Errors: FORBIDDEN, NOT_FOUND (`book` or a referenced field), DUPLICATE.
   */
  updateBook: defineEndpoint<BookAdmin>()({
    method: 'PATCH',
    path: '/books/:bookId',
    params: BookIdParam,
    body: BookUpdateInput,
    access: catalogWrite,
    errors: ['FORBIDDEN', 'NOT_FOUND', 'DUPLICATE'],
  }),
  /** Authors by name prefix. catalog.write. Errors: FORBIDDEN. */
  listAuthors: defineEndpoint<Page<Author>>()({
    method: 'GET',
    path: '/authors',
    query: NameSearchQuery,
    access: catalogWrite,
    errors: ['FORBIDDEN'],
  }),
  /** Create an author. catalog.write. Errors: FORBIDDEN. */
  createAuthor: defineEndpoint<Author>()({
    method: 'POST',
    path: '/authors',
    body: AuthorInput,
    access: catalogWrite,
    errors: ['FORBIDDEN'],
  }),
  /** Publishers by name prefix. catalog.write. Errors: FORBIDDEN. */
  listPublishers: defineEndpoint<Page<Publisher>>()({
    method: 'GET',
    path: '/publishers',
    query: NameSearchQuery,
    access: catalogWrite,
    errors: ['FORBIDDEN'],
  }),
  /** Create a publisher. catalog.write. Errors: FORBIDDEN. */
  createPublisher: defineEndpoint<Publisher>()({
    method: 'POST',
    path: '/publishers',
    body: PublisherInput,
    access: catalogWrite,
    errors: ['FORBIDDEN'],
  }),
  /**
   * Create a category, optionally under a parent. catalog.write.
   * Errors: FORBIDDEN, NOT_FOUND `parentId`, DUPLICATE `categories_parent_name_uq`.
   */
  createCategory: defineEndpoint<Category>()({
    method: 'POST',
    path: '/categories',
    body: CategoryInput,
    access: catalogWrite,
    errors: ['FORBIDDEN', 'NOT_FOUND', 'DUPLICATE'],
  }),
  /** Copies of a book (staff view). catalog.write or loan.checkout. Errors: FORBIDDEN, NOT_FOUND `book`. */
  listCopies: defineEndpoint<Items<Copy>>()({
    method: 'GET',
    path: '/books/:bookId/copies',
    params: BookIdParam,
    access: { kind: 'perm', any: ['catalog.write', 'loan.checkout'] },
    errors: ['FORBIDDEN', 'NOT_FOUND'],
  }),
  /**
   * Register a copy; returns it after the call (a good copy of a reserved book comes back `on_hold`).
   * catalog.write, checked by the procedure. Errors: FORBIDDEN, NOT_FOUND `book`, VALIDATION,
   * DUPLICATE `book_copies_barcode_uq`.
   */
  registerCopy: defineEndpoint<Copy>()({
    method: 'POST',
    path: '/books/:bookId/copies',
    params: BookIdParam,
    body: RegisterCopyInput,
    access: { kind: 'procedure' },
    procedure: 'sp_register_copy',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'DUPLICATE'],
  }),
  /**
   * Maintenance status change (repair, repair done, found, retire); returns the copy after the call.
   * catalog.write, checked by the procedure. Errors: FORBIDDEN, NOT_FOUND `copy`, INVALID_TRANSITION,
   * VALIDATION.
   */
  changeCopyStatus: defineEndpoint<Copy>()({
    method: 'POST',
    path: '/copies/:copyId/status',
    params: CopyIdParam,
    body: ChangeCopyStatusInput,
    access: { kind: 'procedure' },
    procedure: 'sp_change_copy_status',
    errors: ['FORBIDDEN', 'NOT_FOUND', 'INVALID_TRANSITION', 'VALIDATION'],
  }),
};
