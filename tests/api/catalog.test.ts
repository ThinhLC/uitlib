import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools, ownerQuery } from '../helpers/db';
import { checkout, lendingWorld, otherReader, reader, reserve, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req, TestClock } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const clock = new TestClock();
const { app } = createTestApp({ clock });
const now = vn('2026-09-01 09:00');

async function librarian() {
  return (await asAccount(['librarian'])).token;
}

async function authors(token: string, ...names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const name of names) {
    const res = await req(app, 'POST', '/authors', { token, body: { name } });
    expect(res.status).toBe(201);
    ids.push(res.body.id);
  }
  return ids;
}

describe('US3 catalog management', () => {
  it('US3-2: creates a book without ISBN, with ordered authors and categories; PATCH replaces authors', async () => {
    const token = await librarian();
    const [a1, a2, a3] = await authors(token, 'Zed Author', 'Alpha Author', 'Third Author');
    const c1 = await req(app, 'POST', '/categories', { token, body: { name: 'Computing' } });
    const c2 = await req(app, 'POST', '/categories', { token, body: { name: 'Databases', parentId: c1.body.id } });
    expect(c2.body).toMatchObject({ name: 'Databases', parentId: c1.body.id });
    const pub = await req(app, 'POST', '/publishers', { token, body: { name: 'NXB Trẻ' } });

    const created = await req(app, 'POST', '/books', {
      token,
      body: {
        title: '  Cơ sở dữ liệu  ',
        materialType: 'BOOK_PRINT',
        publisherId: pub.body.id,
        publishedYear: 2020,
        languageCode: 'vi',
        coverUrl: 'https://example.com/c.jpg',
        replacementCostVnd: 120000,
        authorIds: [a1, a2],
        categoryIds: [c1.body.id, c2.body.id],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Cơ sở dữ liệu',
      status: 'active',
      replacementCostVnd: 120000,
      publisher: { id: pub.body.id, name: 'NXB Trẻ' },
      authors: [{ id: a1, name: 'Zed Author' }, { id: a2, name: 'Alpha Author' }],
      identifiers: [],
      copies: { available: 0, total: 0 },
    });
    expect(created.body.categories.map((c: any) => c.id).sort()).toEqual([c1.body.id, c2.body.id].sort());

    const id = created.body.id;
    const patched = await req(app, 'PATCH', `/books/${id}`, {
      token,
      body: { authorIds: [a3, a1], subtitle: 'Nhập môn', identifiers: [{ type: 'OTHER', value: 'X-1' }] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.authors.map((a: any) => a.id)).toEqual([a3, a1]);
    expect(patched.body).toMatchObject({ subtitle: 'Nhập môn', identifiers: [{ type: 'OTHER', value: 'X-1' }] });
    expect(patched.body.categories).toHaveLength(2);

    // An empty array clears the set; an omitted array leaves it alone.
    const cleared = await req(app, 'PATCH', `/books/${id}`, { token, body: { categoryIds: [], identifiers: [] } });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ categories: [], identifiers: [] });
    expect(cleared.body.authors.map((a: any) => a.id)).toEqual([a3, a1]);

    const retired = await req(app, 'PATCH', `/books/${id}`, { token, body: { status: 'retired', subtitle: null } });
    expect(retired.body).toMatchObject({ status: 'retired', subtitle: null });
    expect((await req(app, 'GET', `/books/${id}`, { token })).body.status).toBe('retired');
    expect((await req(app, 'GET', `/catalog/books/${id}`)).status).toBe(404);

    const found = await req(app, 'GET', '/authors', { token, query: { q: 'alp' } });
    expect(found.body).toMatchObject({ total: 1, items: [{ id: a2, name: 'Alpha Author' }] });
  });

  it('US3-3: unknown references are 404 with the field name, and nothing is written', async () => {
    const token = await librarian();
    const [a1] = await authors(token, 'Only Author');
    const base = { title: 'T', materialType: 'BOOK_PRINT', authorIds: [a1] };
    const cases: [Record<string, unknown>, string][] = [
      [{ publisherId: 999999 }, 'publisherId'],
      [{ authorIds: [a1, 999999] }, 'authorIds'],
      [{ categoryIds: [999999] }, 'categoryIds'],
      [{ materialType: 'NOPE' }, 'materialType'],
    ];
    for (const [patch, field] of cases) {
      const res = await req(app, 'POST', '/books', { token, body: { ...base, ...patch } });
      expect(res.status, field).toBe(404);
      expect(res.body.error, field).toMatchObject({ key: 'NOT_FOUND', detail: field });
    }
    expect(Number((await ownerQuery('SELECT COUNT(*) n FROM books'))[0].n)).toBe(0);

    const ok = await req(app, 'POST', '/books', { token, body: base });
    const bad = await req(app, 'PATCH', `/books/${ok.body.id}`, { token, body: { title: 'New', categoryIds: [999999] } });
    expect(bad.body.error).toMatchObject({ key: 'NOT_FOUND', detail: 'categoryIds' });
    expect((await req(app, 'GET', `/books/${ok.body.id}`, { token })).body.title).toBe('T');
    expect((await req(app, 'PATCH', '/books/999999', { token, body: { title: 'x' } })).body.error.detail).toBe('book');

    const invalid = await req(app, 'POST', '/books', { token, body: { ...base, coverUrl: 'http://x.com/a.png', authorIds: [] } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields.map((f: any) => f.path).sort()).toEqual(['authorIds', 'coverUrl']);
  });

  it('US3-4: a duplicate barcode is 409 DUPLICATE; a copy on loan cannot go to repair', async () => {
    const w = await lendingWorld({ copies: 1 });
    const token = await librarian();
    const [{ barcode }] = await ownerQuery('SELECT barcode FROM book_copies WHERE id = ?', [w.copies[0]]);

    const dup = await req(app, 'POST', `/books/${w.bookId}/copies`, { token, body: { barcode, condition: 'good' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'book_copies_barcode_uq', message: 'Barcode already in use.' });

    await checkout(w.staff, now, w.readerId, [w.copies[0]]);
    const repair = await req(app, 'POST', `/copies/${w.copies[0]}/status`, {
      token,
      body: { targetStatus: 'in_repair', condition: 'worn' },
    });
    expect(repair.status).toBe(409);
    expect(repair.body.error.key).toBe('INVALID_TRANSITION');
  });

  it('registers copies and changes their maintenance status, returning the re-read Copy', async () => {
    const w = await lendingWorld({ copies: 0 });
    const token = await librarian();
    const reg = await req(app, 'POST', `/books/${w.bookId}/copies`, {
      token,
      body: { barcode: 'NEW-001', shelfCode: 'QA76', acquiredAt: '2026-08-30', condition: 'damaged' },
    });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({
      bookId: w.bookId,
      barcode: 'NEW-001',
      shelfCode: 'QA76',
      acquiredAt: '2026-08-30',
      physicalCondition: 'damaged',
      circulationStatus: 'in_repair',
      heldFor: null,
    });
    const fixed = await req(app, 'POST', `/copies/${reg.body.id}/status`, { token, body: { targetStatus: 'available', condition: 'good' } });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ circulationStatus: 'available', physicalCondition: 'good' });

    const list = await req(app, 'GET', `/books/${w.bookId}/copies`, { token });
    expect(list.body.items.map((c: any) => c.id)).toEqual([reg.body.id]);
    expect((await req(app, 'GET', '/books/999999/copies', { token })).status).toBe(404);
    expect((await req(app, 'POST', '/copies/999999/status', { token, body: { targetStatus: 'retired', condition: 'good' } })).status).toBe(404);
    expect((await req(app, 'POST', `/books/999999/copies`, { token, body: { barcode: 'NEW-002', condition: 'good' } })).body.error)
      .toMatchObject({ key: 'NOT_FOUND', detail: 'book' });
  });

  it('US3-5: a good copy of a book with a waiting reservation comes back on_hold with heldFor', async () => {
    const w = await lendingWorld({ copies: 1 });
    await checkout(w.staff, now, w.readerId, [w.copies[0]]);
    const waiter = await otherReader(w);
    const reservationId = await reserve(w.staff, now, waiter.readerId, w.bookId);
    const token = await librarian();
    clock.set(vn('2026-09-02 10:00'));

    const res = await req(app, 'POST', `/books/${w.bookId}/copies`, { token, body: { barcode: 'HOLD-1', condition: 'good' } });
    expect(res.status).toBe(201);
    expect(res.body.circulationStatus).toBe('on_hold');
    expect(res.body.heldFor).toMatchObject({ reservationId, readerId: waiter.readerId });
    expect(res.body.heldFor.holdExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const list = await req(app, 'GET', `/books/${w.bookId}/copies`, { token });
    expect(list.body.items.find((c: any) => c.id === res.body.id).heldFor.reservationId).toBe(reservationId);
  });

  it('US3-6: a reader account is 403 on catalog writes; category names are unique per parent', async () => {
    const r = await asReader(await reader());
    const res = await req(app, 'POST', '/books', { token: r.token, body: { title: 'x', materialType: 'BOOK_PRINT', authorIds: [1] } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ key: 'FORBIDDEN', detail: 'catalog.write' });
    expect((await req(app, 'GET', '/authors', { token: r.token })).status).toBe(403);
    expect((await req(app, 'POST', '/books/1/copies', { token: r.token, body: { barcode: 'B', condition: 'good' } })).body.error.key)
      .toBe('FORBIDDEN');

    const token = await librarian();
    expect((await req(app, 'POST', '/categories', { token, body: { name: 'History' } })).status).toBe(201);
    const dup = await req(app, 'POST', '/categories', { token, body: { name: 'History' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ key: 'DUPLICATE', detail: 'categories_parent_name_uq' });
    expect((await req(app, 'POST', '/categories', { token, body: { name: 'X', parentId: 999999 } })).body.error.detail).toBe('parentId');
  });
});
