import { pick } from '@/lib/utils';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type {
  Author,
  AuthorInput,
  BookAdmin,
  BookInput,
  BookUpdateInput,
  Category,
  CategoryInput,
  NameSearchQuery,
  Page,
  Publisher,
  PublisherInput,
} from '@/lib/api/contract';
import { ApiError, notFound } from '@/server/api/errors/api-error';
import { isNil, isUndefined, omitUndefined } from '@/lib/utils';
import { loadBookAdmin } from './catalog-search';
import { one, paged, rows, transaction } from './sql';

/** A unique-key collision on a direct write, reported like the procedures do (index name as detail). */
function asDuplicate(err: unknown): unknown {
  const e = err as { errno?: number; message?: string };
  if (e?.errno !== 1062) return err;
  const index = /for key '(?:[^'.]+\.)?([^']+)'/.exec(String(e.message))?.[1] ?? 'unique key';
  return new ApiError('DUPLICATE', index);
}

async function writing<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  try {
    return await transaction(pool, fn);
  } catch (err) {
    throw asDuplicate(err);
  }
}

async function materialTypeId(conn: PoolConnection, code: string): Promise<number> {
  const r = await one(conn, `SELECT id FROM material_types WHERE code = ?`, [code]);
  if (!r) throw notFound('materialType');
  return Number(r.id);
}

/** Throw NOT_FOUND `field` unless every id exists in `table`. */
async function requireAll(conn: PoolConnection, table: 'authors' | 'categories' | 'publishers', ids: number[], field: string) {
  if (!ids.length) return;
  const found = await rows(conn, `SELECT id FROM ${table} WHERE id IN (?) FOR SHARE`, [ids]);
  if (found.length !== new Set(ids).size) throw notFound(field);
}

type Relations = Pick<BookUpdateInput, 'authorIds' | 'categoryIds' | 'identifiers'>;

/** Replace the given child sets of a book (`author_order` = array index + 1). */
async function replaceRelations(conn: PoolConnection, bookId: number, rel: Relations) {
  if (rel.authorIds) {
    await conn.query(`DELETE FROM book_authors WHERE book_id = ?`, [bookId]);
    await conn.query(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES ?`, [
      rel.authorIds.map((a, i) => [bookId, a, i + 1]),
    ]);
  }
  if (rel.categoryIds) {
    await conn.query(`DELETE FROM book_categories WHERE book_id = ?`, [bookId]);
    if (rel.categoryIds.length) {
      await conn.query(`INSERT INTO book_categories (book_id, category_id) VALUES ?`, [
        rel.categoryIds.map((c) => [bookId, c]),
      ]);
    }
  }
  if (rel.identifiers) {
    await conn.query(`DELETE FROM book_identifiers WHERE book_id = ?`, [bookId]);
    if (rel.identifiers.length) {
      await conn.query(`INSERT INTO book_identifiers (book_id, identifier_type, identifier_value) VALUES ?`, [
        rel.identifiers.map((x) => [bookId, x.type, x.value]),
      ]);
    }
  }
}

async function verifyReferences(conn: PoolConnection, input: BookUpdateInput): Promise<number | undefined> {
  const mt = isUndefined(input.materialType) ? undefined : await materialTypeId(conn, input.materialType);
  if (!isNil(input.publisherId)) await requireAll(conn, 'publishers', [input.publisherId], 'publisherId');
  if (input.authorIds) await requireAll(conn, 'authors', input.authorIds, 'authorIds');
  if (input.categoryIds) await requireAll(conn, 'categories', input.categoryIds, 'categoryIds');
  return mt;
}

async function readBack(conn: PoolConnection, id: number): Promise<BookAdmin> {
  const book = await loadBookAdmin(conn, id);
  if (!book) throw notFound('book');
  return book;
}

/** Create a book and its authors, categories and identifiers in one transaction (FR-024). */
export function createBook(pool: Pool, input: BookInput, dbNow: string): Promise<BookAdmin> {
  return writing(pool, async (conn) => {
    const mt = (await verifyReferences(conn, input)) as number;
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO books (title, subtitle, publisher_id, published_date_text, published_year, description,
                          language_code, cover_url, material_type_id, classification_code, replacement_cost_vnd,
                          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [input.title, input.subtitle ?? null, input.publisherId ?? null, input.publishedDateText ?? null,
        input.publishedYear ?? null, input.description ?? null, input.languageCode ?? null, input.coverUrl ?? null,
        mt, input.classificationCode ?? null, input.replacementCostVnd ?? null, dbNow, dbNow],
    );
    const id = res.insertId;
    await replaceRelations(conn, id, input);
    return readBack(conn, id);
  });
}

/** Column of each scalar field of BookUpdateInput. */
const COLUMNS = {
  title: 'title',
  subtitle: 'subtitle',
  description: 'description',
  publishedDateText: 'published_date_text',
  coverUrl: 'cover_url',
  classificationCode: 'classification_code',
  publishedYear: 'published_year',
  languageCode: 'language_code',
  publisherId: 'publisher_id',
  replacementCostVnd: 'replacement_cost_vnd',
  status: 'status',
} as const satisfies Partial<Record<keyof BookUpdateInput, string>>;

/** Update a book; given arrays replace the stored sets, all in one transaction (FR-024). */
export function updateBook(pool: Pool, id: number, input: BookUpdateInput, dbNow: string): Promise<BookAdmin> {
  return writing(pool, async (conn) => {
    if (!(await one(conn, `SELECT id FROM books WHERE id = ? FOR UPDATE`, [id]))) throw notFound('book');
    const mt = await verifyReferences(conn, input);
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [dbNow];
    // Only the fields sent are changed; `null` clears an optional field.
    for (const [field, v] of Object.entries(omitUndefined(pick(input, Object.keys(COLUMNS) as (keyof typeof COLUMNS)[])))) {
      sets.push(`${COLUMNS[field as keyof typeof COLUMNS]} = ?`);
      params.push(v);
    }
    if (!isUndefined(mt)) {
      sets.push('material_type_id = ?');
      params.push(mt);
    }
    await conn.query(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    await replaceRelations(conn, id, input);
    return readBack(conn, id);
  });
}

/** Staff view of a book; NOT_FOUND `book` when missing. */
export async function getBookAdmin(pool: Pool, id: number): Promise<BookAdmin> {
  const book = await loadBookAdmin(pool, id);
  if (!book) throw notFound('book');
  return book;
}

const likePrefix = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function listNamed(pool: Pool, table: 'authors' | 'publishers', query: NameSearchQuery): Promise<Page<Author>> {
  const where = query.q ? `WHERE name LIKE CONCAT(?, '%')` : '';
  return paged(pool, {
    select: `SELECT id, name FROM ${table} ${where} ORDER BY name, id`,
    count: `SELECT COUNT(*) FROM ${table} ${where}`,
    params: query.q ? [likePrefix(query.q)] : [],
    page: query,
    map: (r) => ({ id: Number(r.id), name: r.name }),
  });
}

async function insertNamed(pool: Pool, table: 'authors' | 'publishers', name: string): Promise<Author> {
  const [res] = await pool.query<ResultSetHeader>(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
  return { id: res.insertId, name };
}

export const listAuthors = (pool: Pool, q: NameSearchQuery): Promise<Page<Author>> => listNamed(pool, 'authors', q);
export const listPublishers = (pool: Pool, q: NameSearchQuery): Promise<Page<Publisher>> =>
  listNamed(pool, 'publishers', q);
export const createAuthor = (pool: Pool, input: AuthorInput): Promise<Author> => insertNamed(pool, 'authors', input.name);
export const createPublisher = (pool: Pool, input: PublisherInput): Promise<Publisher> =>
  insertNamed(pool, 'publishers', input.name);

/** Create a category; NOT_FOUND `parentId` for an unknown parent, DUPLICATE for a name taken under it. */
export function createCategory(pool: Pool, input: CategoryInput): Promise<Category> {
  return writing(pool, async (conn) => {
    const parentId = input.parentId ?? null;
    if (!isNil(parentId)) await requireAll(conn, 'categories', [parentId], 'parentId');
    // The unique index does not compare NULL parents, so top-level names are checked here.
    if (await one(conn, `SELECT id FROM categories WHERE parent_id <=> ? AND name = ? FOR UPDATE`, [parentId, input.name])) {
      throw new ApiError('DUPLICATE', 'categories_parent_name_uq');
    }
    const [res] = await conn.query<ResultSetHeader>(`INSERT INTO categories (name, parent_id) VALUES (?, ?)`, [
      input.name,
      parentId,
    ]);
    return { id: res.insertId, name: input.name, parentId };
  });
}
