import { randomUUID } from 'node:crypto';
import { call, ownerConn } from './db';
import { vn } from './time';
import { truncateData } from '../../scripts/db/truncate';

/** Empty every non-reference table. TRUNCATE does not fire DELETE triggers. */
export async function truncateAll(): Promise<void> {
  const conn = await ownerConn();
  try {
    await truncateData(conn);
  } finally {
    await conn.end();
  }
}

async function ownerExec(sql: string, params: unknown[] = []): Promise<any> {
  const conn = await ownerConn();
  try {
    const [res] = await conn.query(sql, params);
    return res;
  } finally {
    await conn.end();
  }
}

async function idOf(table: string, code: string): Promise<number> {
  const rows = await ownerExec(`SELECT id FROM \`${table}\` WHERE code = ?`, [code]);
  if (!rows.length) throw new Error(`${table}.${code} not found`);
  return Number(rows[0].id);
}

export const materialTypeId = (code = 'BOOK_PRINT') => idOf('material_types', code);
export const readerTypeId = (code: string) => idOf('reader_types', code);

/** An application account holding the given role codes. */
export async function account(
  roles: string[] = ['librarian'],
  opts: { status?: 'active' | 'inactive' } = {},
): Promise<number> {
  const res = await ownerExec(
    `INSERT INTO app_users (supabase_user_id, status, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))`,
    [randomUUID(), opts.status ?? 'active'],
  );
  const id = Number(res.insertId);
  for (const r of roles) {
    await ownerExec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [id, await idOf('roles', r)]);
  }
  return id;
}

export const admin = () => account(['admin']);

export async function reader(
  typeCode = 'STUDENT',
  opts: { status?: string; userId?: number | null; name?: string } = {},
): Promise<number> {
  const res = await ownerExec(
    `INSERT INTO readers (user_id, reader_type_id, full_name, email, phone, status, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?, UTC_TIMESTAMP(3))`,
    [opts.userId ?? null, await readerTypeId(typeCode), opts.name ?? `Reader ${randomUUID().slice(0, 8)}`,
      opts.status ?? 'active'],
  );
  return Number(res.insertId);
}

export async function book(
  opts: {
    title?: string;
    replacementCost?: number | null;
    authors?: string[];
    categories?: string[];
    identifiers?: { type: 'ISBN_10' | 'ISBN_13' | 'OTHER'; value: string }[];
  } = {},
): Promise<number> {
  const res = await ownerExec(
    `INSERT INTO books (title, material_type_id, replacement_cost_vnd, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [opts.title ?? `Book ${randomUUID().slice(0, 8)}`, await materialTypeId(),
      opts.replacementCost === undefined ? 150_000 : opts.replacementCost],
  );
  const id = Number(res.insertId);
  let order = 1;
  for (const name of opts.authors ?? []) {
    const a = await ownerExec(`INSERT INTO authors (name) VALUES (?)`, [name]);
    await ownerExec(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES (?, ?, ?)`,
      [id, a.insertId, order++]);
  }
  for (const name of opts.categories ?? []) {
    const c = await ownerExec(`INSERT INTO categories (name, parent_id) VALUES (?, NULL)`, [name]);
    await ownerExec(`INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)`, [id, c.insertId]);
  }
  for (const ident of opts.identifiers ?? []) {
    await ownerExec(
      `INSERT INTO book_identifiers (book_id, identifier_type, identifier_value) VALUES (?, ?, ?)`,
      [id, ident.type, ident.value],
    );
  }
  return id;
}

export interface PolicyValues {
  maxItems?: number;
  loanDays?: number;
  maxRenewals?: number;
  dailyFee?: number;
  debtThreshold?: number;
  validFrom?: string;
}

/** Create a policy version through sp_create_policy_version. */
export async function policy(actor: number, now: string, typeCode = 'STUDENT', v: PolicyValues = {}) {
  const { out } = await call(
    'sp_create_policy_version',
    [actor, now, await readerTypeId(typeCode), await materialTypeId(), v.maxItems ?? 5, v.loanDays ?? 14,
      v.maxRenewals ?? 2, v.dailyFee ?? 2000, v.debtThreshold ?? 50_000, v.validFrom ?? vn('2026-01-01 00:00')],
    { outParams: ['p_policy_id'] },
  );
  return Number((out as any).p_policy_id);
}

/** Issue an active card through sp_issue_card. */
export async function card(actor: number, now: string, readerId: number, expiresAt = vn('2027-12-31 23:59')) {
  const { out } = await call('sp_issue_card', [actor, now, readerId, `C-${randomUUID().slice(0, 12)}`, expiresAt],
    { outParams: ['p_card_id'] });
  return Number((out as any).p_card_id);
}

/** Register a copy through sp_register_copy. */
export async function copy(
  actor: number,
  now: string,
  bookId: number,
  opts: { barcode?: string; condition?: 'good' | 'worn' | 'damaged' } = {},
) {
  const { out } = await call(
    'sp_register_copy',
    [actor, now, bookId, opts.barcode ?? `B-${randomUUID().slice(0, 12)}`, 'A1', null, opts.condition ?? 'good'],
    { outParams: ['p_copy_id'] },
  );
  return Number((out as any).p_copy_id);
}

/**
 * A ready-to-lend world: an admin, a STUDENT policy from 2026-01-01, a reader with a valid card,
 * and one book with `copies` copies.
 */
export async function lendingWorld(opts: { copies?: number; policy?: PolicyValues; readerType?: string } = {}) {
  const staff = await admin();
  const now = vn('2026-09-01 09:00');
  const policyId = await policy(staff, now, opts.readerType ?? 'STUDENT', opts.policy);
  const readerId = await reader(opts.readerType ?? 'STUDENT');
  await card(staff, now, readerId);
  const bookId = await book();
  const copies: number[] = [];
  for (let i = 0; i < (opts.copies ?? 1); i++) copies.push(await copy(staff, now, bookId));
  return { staff, now, policyId, readerId, bookId, copies };
}

/** sp_checkout: returns [{ loan_id, loan_item_id, copy_id, due_at }]. */
export async function checkout(actor: number, now: string, readerId: number, copyIds: number[]) {
  const { rows } = await call('sp_checkout', [actor, now, readerId, JSON.stringify(copyIds)]);
  return (rows[0] ?? []).map((r: any) => ({
    loanId: Number(r.loan_id),
    loanItemId: Number(r.loan_item_id),
    copyId: Number(r.copy_id),
    dueAt: String(r.due_at),
  }));
}

/** sp_return_item: returns the fines assessed, [{ fine_id, fine_type, assessed_amount_vnd }]. */
export async function returnItem(
  actor: number, now: string, loanItemId: number,
  condition: 'good' | 'worn' | 'damaged' = 'good', damagedFine: number | null = null, reason: string | null = null,
) {
  const { rows } = await call('sp_return_item', [actor, now, loanItemId, condition, damagedFine, reason]);
  return rows[0] ?? [];
}

/** sp_declare_lost: returns the fines assessed. */
export async function declareLost(
  actor: number, now: string, loanItemId: number, lostFine: number | null = null, reason: string | null = null,
) {
  const { rows } = await call('sp_declare_lost', [actor, now, loanItemId, lostFine, reason]);
  return rows[0] ?? [];
}

/** sp_renew: returns the new due time. */
export async function renew(actor: number, now: string, loanItemId: number): Promise<string> {
  const { out } = await call('sp_renew', [actor, now, loanItemId], { outParams: ['p_new_due_at'] });
  return String((out as any).p_new_due_at);
}

/** sp_record_payment: allocations must add up to `amount` (FR-016). */
export async function pay(
  actor: number, now: string, readerId: number, amount: number,
  allocations: { fineId: number; amount: number }[], requestKey = `REQ-${randomUUID()}`,
) {
  const { out } = await call(
    'sp_record_payment',
    [actor, now, readerId, amount, 'cash', null, requestKey,
      JSON.stringify(allocations.map((a) => ({ fine_id: a.fineId, amount_vnd: a.amount })))],
    { outParams: ['p_payment_id', 'p_replayed'] },
  );
  return { paymentId: Number((out as any).p_payment_id), replayed: Boolean(Number((out as any).p_replayed)) };
}

/** sp_adjust_fine: signed correction with a reason (FR-017). */
export async function adjust(actor: number, now: string, fineId: number, amount: number, reason: string | null) {
  const { out } = await call('sp_adjust_fine', [actor, now, fineId, amount, reason], { outParams: ['p_adjustment_id'] });
  return Number((out as any).p_adjustment_id);
}

/**
 * A reader with one late fine of `days` × `dailyFee`, assessed when the item is returned at
 * `returnedAt` (local). Returns the fine id and the world.
 */
export async function lateFine(opts: { days: number; dailyFee?: number; returnedAt?: string; world?: any }) {
  const w = opts.world ?? (await lendingWorld({ copies: 4, policy: { dailyFee: opts.dailyFee ?? 2000, loanDays: 14 } }));
  const returnedAt = opts.returnedAt ?? vn('2026-10-20 10:00');
  // borrow so that the due date is `days` local days before the return day
  const ret = new Date(returnedAt.replace(' ', 'T') + 'Z');
  const borrowLocalDay = new Date(ret.getTime() + 7 * 3600_000 - (opts.days + 14) * 86_400_000);
  const borrowedAt = vn(`${borrowLocalDay.toISOString().slice(0, 10)} 10:00`);
  const free = await ownerExec(
    `SELECT id FROM book_copies WHERE book_id = ? AND circulation_status = 'available' ORDER BY id LIMIT 1`, [w.bookId]);
  const [li] = await checkout(w.staff, borrowedAt, w.readerId, [Number(free[0].id)]);
  const fines = await returnItem(w.staff, returnedAt, li.loanItemId);
  return { world: w, fineId: Number(fines[0].fine_id), amount: Number(fines[0].assessed_amount_vnd), loanItemId: li.loanItemId };
}

/** The same lending world (staff, policy, book) with a new reader holding a valid card. */
export async function otherReader(w: { staff: number; now: string; bookId: number; [k: string]: any }) {
  const readerId = await reader();
  await card(w.staff, w.now, readerId);
  return { ...w, readerId };
}
