import type { Connection } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appConn, call, closeTestPools, expectErrno, ownerQuery } from '../helpers/db';
import { account, book, copy, materialTypeId, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);
beforeEach(truncateAll);

const NOW = vn('2026-09-01 09:00');

async function withApp<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  const c = await appConn();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function insertBook(c: Connection, title: string, extra: Record<string, unknown> = {}) {
  const cols = { title, material_type_id: await materialTypeId(), status: 'active', ...extra };
  const [res] = (await c.query(
    `INSERT INTO books (${Object.keys(cols).join(', ')}, created_at, updated_at)
     VALUES (${Object.keys(cols).map(() => '?').join(', ')}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    Object.values(cols),
  )) as any;
  return Number(res.insertId);
}

describe('US1 catalog (T033)', () => {
  it('US1-1: a book with two ordered authors and three categories is retrievable', async () => {
    await withApp(async (c) => {
      const bookId = await insertBook(c, 'Database System Concepts');
      for (const [i, name] of ['Silberschatz', 'Korth'].entries()) {
        const [a] = (await c.query(`INSERT INTO authors (name) VALUES (?)`, [name])) as any;
        await c.query(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES (?, ?, ?)`,
          [bookId, a.insertId, i + 1]);
      }
      for (const name of ['Databases', 'Computer science', 'Textbooks']) {
        const [cat] = (await c.query(`INSERT INTO categories (name) VALUES (?)`, [name])) as any;
        await c.query(`INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)`, [bookId, cat.insertId]);
      }
      const [authors] = (await c.query(
        `SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
          WHERE ba.book_id = ? ORDER BY ba.author_order`, [bookId])) as any;
      expect(authors.map((r: any) => r.name)).toEqual(['Silberschatz', 'Korth']);
      const [[cats]] = (await c.query(`SELECT COUNT(*) n FROM book_categories WHERE book_id = ?`, [bookId])) as any;
      expect(Number(cats.n)).toBe(3);
      // author_order is unique per book
      const [a3] = (await c.query(`INSERT INTO authors (name) VALUES ('Sudarshan')`)) as any;
      await expectErrno(
        c.query(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES (?, ?, 1)`, [bookId, a3.insertId]),
        1062,
      );
    });
  });

  it('US1-2: three copies registered through sp_register_copy each keep their own status', async () => {
    const staff = await account(['librarian']);
    const bookId = await book();
    const ids = [];
    for (const barcode of ['B0001', 'B0002', 'B0003']) ids.push(await copy(staff, NOW, bookId, { barcode }));
    const rows = await ownerQuery(
      `SELECT barcode, physical_condition, circulation_status FROM book_copies WHERE book_id = ? ORDER BY barcode`,
      [bookId]);
    expect(rows).toEqual([
      { barcode: 'B0001', physical_condition: 'good', circulation_status: 'available' },
      { barcode: 'B0002', physical_condition: 'good', circulation_status: 'available' },
      { barcode: 'B0003', physical_condition: 'good', circulation_status: 'available' },
    ]);
  });

  it('US1-3 R-01: a duplicate barcode is rejected (1062)', async () => {
    const staff = await account(['librarian']);
    const bookId = await book();
    await copy(staff, NOW, bookId, { barcode: 'B0001' });
    await expectErrno(call('sp_register_copy', [staff, NOW, bookId, 'B0001', 'A1', null, 'good'],
      { outParams: ['p_copy_id'] }), 1062);
  });

  it('US1-4: two editions with the same title are two books', async () => {
    await withApp(async (c) => {
      const [p1] = (await c.query(`INSERT INTO publishers (name) VALUES ('Pearson')`)) as any;
      const [p2] = (await c.query(`INSERT INTO publishers (name) VALUES ('McGraw-Hill')`)) as any;
      const a = await insertBook(c, 'Operating Systems', { publisher_id: p1.insertId, published_year: 2012 });
      const b = await insertBook(c, 'Operating Systems', { publisher_id: p2.insertId, published_year: 2018 });
      expect(a).not.toBe(b);
    });
  });

  it('US1-5: a book without ISBN, cover or description is accepted', async () => {
    await withApp(async (c) => {
      const id = await insertBook(c, 'Hand-written lecture notes');
      const [[row]] = (await c.query(
        `SELECT cover_url, description, (SELECT COUNT(*) FROM book_identifiers WHERE book_id = b.id) idents
           FROM books b WHERE id = ?`, [id])) as any;
      expect(row).toEqual({ cover_url: null, description: null, idents: 0 });
    });
  });

  it('US1-6 R-03: a second external reference with the same provider and id is rejected (1062)', async () => {
    await withApp(async (c) => {
      const k1 = await insertBook(c, 'Clean Code');
      const k2 = await insertBook(c, 'Clean Code (duplicate import)');
      const ref = (bookId: number) => c.query(
        `INSERT INTO book_external_refs (book_id, provider, external_id, raw_snapshot, fetched_at)
         VALUES (?, 'GOOGLE_BOOKS', 'V1', JSON_OBJECT('id', 'V1'), UTC_TIMESTAMP(3))`, [bookId]);
      await ref(k1);
      await expectErrno(ref(k2), 1062);
    });
  });

  it('US1-9 R-06a: a damaged copy cannot be available (3819)', async () => {
    const staff = await account(['librarian']);
    const copyId = await copy(staff, NOW, await book());
    await expectErrno(
      ownerQuery(`UPDATE book_copies SET physical_condition = 'damaged' WHERE id = ?`, [copyId]), 3819);
    await expectErrno(call('sp_change_copy_status', [staff, NOW, copyId, 'available', 'damaged']), 3819);
  });

  it('FR-021 R-02: a book with copies cannot be deleted (1451)', async () => {
    const staff = await account(['librarian']);
    const bookId = await book();
    await copy(staff, NOW, bookId);
    await withApp((c) => expectErrno(c.query(`DELETE FROM books WHERE id = ?`, [bookId]), 1451));
  });
});
