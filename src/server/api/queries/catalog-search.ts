import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  BookAdmin,
  BookDetail,
  BookSummary,
  CatalogRef,
  CatalogSearchQuery,
  Category,
  IdentifierType,
  Page,
} from '@/lib/api/contract';
import { notFound } from '@/server/api/errors/api-error';
import { isNil, mapNullable, toNumberOrNull } from '@/lib/utils';
import { paged, rows } from './sql';

type Db = Pool | PoolConnection;

/** InnoDB's `innodb_ft_min_token_size` default: shorter terms are not in the FULLTEXT index. */
const MIN_FT_TERM = 3;

/** Escape `%`, `_` and `\` for a `LIKE CONCAT(?, '%')` prefix. */
const likePrefix = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Boolean-mode terms for `MATCH … AGAINST`: each term of 3+ characters, stripped of the operators
 * `+-<>()~*"@`, suffixed with `*` (research R10). Empty when every term is shorter.
 */
export function fulltextTerms(q: string): string {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/[+\-<>()~*"@]/g, ''))
    .filter((t) => t.length >= MIN_FT_TERM)
    .map((t) => `${t}*`)
    .join(' ');
}

/**
 * The join and filters of the public search: active books matching `q` (FULLTEXT on title/subtitle UNION
 * author-name prefix, or a title prefix when every term is short), a category or its direct
 * children, an exact identifier value and a material type code. Ordered by title, id.
 */
export function searchSql(query: Omit<CatalogSearchQuery, 'page' | 'pageSize'>): {
  join: string;
  where: string;
  params: unknown[];
} {
  const conds = [`b.status = 'active'`];
  const params: unknown[] = [];
  let join = '';
  const q = query.q?.trim();
  if (q) {
    // A derived UNION of ids, so each branch uses its own index (FULLTEXT, authors_name_ix).
    const terms = fulltextTerms(q);
    const titleMatch = terms
      ? `SELECT id FROM books WHERE MATCH(title, subtitle) AGAINST (? IN BOOLEAN MODE)`
      : `SELECT id FROM books WHERE title LIKE CONCAT(?, '%')`;
    join = `JOIN (${titleMatch}
      UNION SELECT ba.book_id FROM authors a JOIN book_authors ba ON ba.author_id = a.id
             WHERE a.name LIKE CONCAT(?, '%')) m ON m.id = b.id`;
    params.push(terms || likePrefix(q), likePrefix(q));
  }
  if (!isNil(query.categoryId)) {
    conds.push(`b.id IN (SELECT bc.book_id FROM book_categories bc JOIN categories c ON c.id = bc.category_id
                          WHERE c.id = ? OR c.parent_id = ?)`);
    params.push(query.categoryId, query.categoryId);
  }
  if (!isNil(query.identifier)) {
    conds.push(`b.id IN (SELECT book_id FROM book_identifiers WHERE identifier_value = ?)`);
    params.push(query.identifier);
  }
  if (!isNil(query.materialType)) {
    conds.push(`mt.code = ?`);
    params.push(query.materialType);
  }
  return { join, where: conds.join('\n   AND '), params };
}

const BOOK_COLUMNS = `b.id, b.title, b.subtitle, b.published_year, b.language_code, b.cover_url,
       b.published_date_text, b.description, b.classification_code, b.replacement_cost_vnd, b.status,
       mt.code AS material_type, p.id AS publisher_id, p.name AS publisher_name`;
const BOOK_FROM = `books b JOIN material_types mt ON mt.id = b.material_type_id
  LEFT JOIN publishers p ON p.id = b.publisher_id`;

interface Related {
  authors: Map<number, CatalogRef[]>;
  categories: Map<number, CatalogRef[]>;
  copies: Map<number, { available: number; total: number }>;
}

function push<T>(map: Map<number, T[]>, key: number, v: T) {
  const list = map.get(key);
  if (list) list.push(v);
  else map.set(key, [v]);
}

/** Authors (by `author_order`), categories and grouped copy counts for a set of books: 3 queries. */
async function loadRelated(db: Db, ids: number[]): Promise<Related> {
  const out: Related = { authors: new Map(), categories: new Map(), copies: new Map() };
  if (!ids.length) return out;
  const [authors, categories, copies] = await Promise.all([
    rows(db, `SELECT ba.book_id, a.id, a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
               WHERE ba.book_id IN (?) ORDER BY ba.book_id, ba.author_order`, [ids]),
    rows(db, `SELECT bc.book_id, c.id, c.name FROM book_categories bc JOIN categories c ON c.id = bc.category_id
               WHERE bc.book_id IN (?) ORDER BY bc.book_id, c.name, c.id`, [ids]),
    rows(db, `SELECT book_id,
                     SUM(circulation_status = 'available') AS available,
                     SUM(circulation_status NOT IN ('retired', 'lost')) AS total
                FROM book_copies WHERE book_id IN (?) GROUP BY book_id`, [ids]),
  ]);
  for (const r of authors) push(out.authors, Number(r.book_id), { id: Number(r.id), name: r.name });
  for (const r of categories) push(out.categories, Number(r.book_id), { id: Number(r.id), name: r.name });
  for (const r of copies) out.copies.set(Number(r.book_id), { available: Number(r.available), total: Number(r.total) });
  return out;
}

function toSummary(r: RowDataPacket, rel: Related): BookSummary {
  const id = Number(r.id);
  return {
    id,
    title: r.title,
    subtitle: r.subtitle,
    authors: rel.authors.get(id) ?? [],
    categories: rel.categories.get(id) ?? [],
    publishedYear: toNumberOrNull(r.published_year),
    languageCode: r.language_code,
    coverUrl: r.cover_url,
    materialType: r.material_type,
    copies: rel.copies.get(id) ?? { available: 0, total: 0 },
  };
}

/** The page and count statements of the search (also used by `pnpm db:explain`). */
export function searchStatements(query: Omit<CatalogSearchQuery, 'page' | 'pageSize'>) {
  const { join, where, params } = searchSql(query);
  return {
    select: `SELECT ${BOOK_COLUMNS} FROM ${BOOK_FROM} ${join} WHERE ${where} ORDER BY b.title, b.id`,
    count: `SELECT COUNT(*) AS n FROM ${BOOK_FROM} ${join} WHERE ${where}`,
    params,
  };
}

/** Public search (FR-015, research R10): a page of BookSummary. */
export async function searchCatalog(pool: Pool, query: CatalogSearchQuery): Promise<Page<BookSummary>> {
  const page = await paged(pool, {
    ...searchStatements(query),
    page: query,
    map: (r) => r,
  });
  const rel = await loadRelated(pool, page.items.map((r) => Number(r.id)));
  return { ...page, items: page.items.map((r) => toSummary(r, rel)) };
}

/** Staff view of one book, any status; null when it does not exist. */
export async function loadBookAdmin(db: Db, id: number): Promise<BookAdmin | null> {
  const [r] = await rows(db, `SELECT ${BOOK_COLUMNS} FROM ${BOOK_FROM} WHERE b.id = ?`, [id]);
  if (!r) return null;
  const [rel, identifiers] = await Promise.all([
    loadRelated(db, [id]),
    rows(db, `SELECT identifier_type, identifier_value FROM book_identifiers WHERE book_id = ? ORDER BY id`, [id]),
  ]);
  return {
    ...toSummary(r, rel),
    publisher: mapNullable(r.publisher_id, (id) => ({ id: Number(id), name: r.publisher_name })),
    publishedDateText: r.published_date_text,
    description: r.description,
    classificationCode: r.classification_code,
    identifiers: identifiers.map((i) => ({ type: i.identifier_type as IdentifierType, value: i.identifier_value })),
    replacementCostVnd: toNumberOrNull(r.replacement_cost_vnd),
    status: r.status,
  };
}

/** One public book: active only; a missing or retired book is NOT_FOUND `book` (Clarification A1). */
export async function getPublicBook(pool: Pool, id: number): Promise<BookDetail> {
  const book = await loadBookAdmin(pool, id);
  if (!book || book.status !== 'active') throw notFound('book');
  // Pick the public fields explicitly so staff-only ones never leak.
  const { replacementCostVnd: _cost, status: _status, ...detail } = book;
  void _cost;
  void _status;
  return detail;
}

/** Every category, flat (public). */
export async function listCategories(pool: Pool): Promise<Category[]> {
  const list = await rows(pool, `SELECT id, name, parent_id FROM categories ORDER BY name, id`);
  return list.map((r) => ({ id: Number(r.id), name: r.name, parentId: toNumberOrNull(r.parent_id) }));
}
