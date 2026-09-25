import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { admin, book, checkout, copy, lendingWorld, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { createTestApp, req } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app } = createTestApp();
const now = vn('2026-09-01 09:00');

const FORBIDDEN_KEYS = ['barcode', 'shelfCode', 'replacementCostVnd', 'reader', 'readerId', 'heldFor', 'fullName'];

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe('US3-1 public catalog (Clarification A1)', () => {
  it('searches without a token by title word and author prefix, with copy counts and no staff data', async () => {
    const w = await lendingWorld({ copies: 3 });
    await ownerQuery(`UPDATE books SET title = 'Distributed Databases', subtitle = 'Principles' WHERE id = ?`, [w.bookId]);
    const a = await ownerQuery(`INSERT INTO authors (name) VALUES ('Tanenbaum Andrew')`);
    await ownerQuery(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES (?, ?, 1)`, [w.bookId, (a as any).insertId]);
    await checkout(w.staff, now, w.readerId, [w.copies[0]]);
    await ownerQuery(`UPDATE book_copies SET circulation_status = 'retired' WHERE id = ?`, [w.copies[2]]);
    await book({ title: 'Cooking at Home', authors: ['Someone Else'] });

    const byTitle = await req(app, 'GET', '/catalog/books', { query: { q: 'databases' } });
    expect(byTitle.status).toBe(200);
    expect(byTitle.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(byTitle.body.items[0]).toMatchObject({
      id: w.bookId,
      title: 'Distributed Databases',
      subtitle: 'Principles',
      materialType: 'BOOK_PRINT',
      authors: [{ name: 'Tanenbaum Andrew' }],
      copies: { available: 1, total: 2 },
    });

    const prefix = await req(app, 'GET', '/catalog/books', { query: { q: 'datab' } });
    expect(prefix.body.items.map((b: any) => b.id)).toEqual([w.bookId]);

    const byAuthor = await req(app, 'GET', '/catalog/books', { query: { q: 'Tanen' } });
    expect(byAuthor.body.items.map((b: any) => b.id)).toEqual([w.bookId]);

    const detail = await req(app, 'GET', `/catalog/books/${w.bookId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: w.bookId, publisher: null, identifiers: [], copies: { available: 1, total: 2 } });

    const all = await req(app, 'GET', '/catalog/books');
    expect(all.body.total).toBe(2);
    for (const body of [byTitle.body, byAuthor.body, detail.body, all.body]) {
      const keys = keysOf(body);
      for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
    }
  });

  it('a retired or missing book is 404 and not listed', async () => {
    const id = await book({ title: 'Old Manual' });
    await ownerQuery(`UPDATE books SET status = 'retired' WHERE id = ?`, [id]);
    const res = await req(app, 'GET', `/catalog/books/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ key: 'NOT_FOUND', detail: 'book' });
    expect((await req(app, 'GET', '/catalog/books/999999')).status).toBe(404);
    expect((await req(app, 'GET', '/catalog/books', { query: { q: 'manual' } })).body.total).toBe(0);
  });

  it('categoryId includes direct child categories', async () => {
    const parent = (await ownerQuery(`INSERT INTO categories (name) VALUES ('Science')`) as any).insertId;
    const child = (await ownerQuery(`INSERT INTO categories (name, parent_id) VALUES ('Physics', ?)`, [parent]) as any).insertId;
    const other = (await ownerQuery(`INSERT INTO categories (name) VALUES ('Art')`) as any).insertId;
    const inParent = await book({ title: 'General Science' });
    const inChild = await book({ title: 'Quantum Physics' });
    const inOther = await book({ title: 'Painting' });
    await ownerQuery(`INSERT INTO book_categories (book_id, category_id) VALUES (?, ?), (?, ?), (?, ?)`,
      [inParent, parent, inChild, child, inOther, other]);

    const res = await req(app, 'GET', '/catalog/books', { query: { categoryId: parent } });
    expect(res.body.items.map((b: any) => b.id).sort()).toEqual([inParent, inChild].sort());
    const onlyChild = await req(app, 'GET', '/catalog/books', { query: { categoryId: child } });
    expect(onlyChild.body.items.map((b: any) => b.id)).toEqual([inChild]);

    const cats = await req(app, 'GET', '/catalog/categories');
    expect(cats.status).toBe(200);
    expect(cats.body.items).toContainEqual({ id: child, name: 'Physics', parentId: parent });
  });

  it('an exact identifier matches', async () => {
    const id = await book({ title: 'Identified', identifiers: [{ type: 'ISBN_13', value: '9780131103627' }] });
    await book({ title: 'Other' });
    const res = await req(app, 'GET', '/catalog/books', { query: { identifier: '9780131103627' } });
    expect(res.body.items.map((b: any) => b.id)).toEqual([id]);
    expect((await req(app, 'GET', '/catalog/books', { query: { identifier: '978013110362' } })).body.total).toBe(0);
    const detail = await req(app, 'GET', `/catalog/books/${id}`);
    expect(detail.body.identifiers).toEqual([{ type: 'ISBN_13', value: '9780131103627' }]);
  });

  it('a 2-letter q falls back to a title prefix search', async () => {
    const go = await book({ title: 'Go Programming' });
    await book({ title: 'Learning Go' });
    const res = await req(app, 'GET', '/catalog/books', { query: { q: 'Go' } });
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: any) => b.id)).toEqual([go]);
  });

  it('filters by material type and pages results', async () => {
    const staff = await admin();
    for (const t of ['Alpha', 'Beta', 'Gamma']) await copy(staff, now, await book({ title: t }));
    const p2 = await req(app, 'GET', '/catalog/books', { query: { page: 2, pageSize: 2 } });
    expect(p2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(p2.body.items.map((b: any) => b.title)).toEqual(['Gamma']);
    expect((await req(app, 'GET', '/catalog/books', { query: { materialType: 'NOPE' } })).body.total).toBe(0);
    expect((await req(app, 'GET', '/catalog/books', { query: { materialType: 'BOOK_PRINT' } })).body.total).toBe(3);
  });

  it('pageSize 101 is a validation error', async () => {
    const res = await req(app, 'GET', '/catalog/books', { query: { pageSize: 101 } });
    expect(res.status).toBe(400);
    expect(res.body.error.key).toBe('VALIDATION');
  });
});
