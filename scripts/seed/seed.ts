/**
 * Deterministic sample data (spec FR-025/025a/025b, research R13, tasks T083).
 * Usage: pnpm db:seed [--test | --schema <name>] [--reset]
 *
 * 1. Validates data/seed/*.json (contracts/seed-data-format.md).
 * 2. Inserts catalog and people data directly as the app account (the only tables it may write).
 * 3. Registers copies and runs a time-ordered scenario through the operation procedures with
 *    explicit times, so the sample history passes the same rules as live data.
 * 4. Runs the invariant suite. Never calls Google Books.
 */
import { existsSync, readFileSync } from 'node:fs';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { callProcedure, DbRuleError } from '../../src/lib/db/call-procedure';
import { dbConfig } from '../../src/lib/db/config';
import { findViolations } from '../db/check';
import { schemaFromArgs } from '../db/grants';
import { dataTables, truncateData } from '../db/truncate';
import { vn } from '../../tests/helpers/time';

// ---------------------------------------------------------------- data files

type IdentType = 'ISBN_10' | 'ISBN_13' | 'OTHER';

interface BookData {
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDateText: string | null;
  publishedYear: number | null;
  description: string | null;
  languageCode: string | null;
  coverUrl: string | null;
  categories: string[];
  identifiers: { type: IdentType; value: string }[];
}

interface LibraryData {
  classificationCode: string | null;
  replacementCostVnd: number | null;
  copies: { barcode: string; shelfCode: string | null; condition: 'good' | 'worn' | 'damaged' }[];
}

interface GoogleRecord {
  provider: 'GOOGLE_BOOKS';
  externalId: string;
  fetchedAt: string;
  reviewed: boolean;
  distinctEditionOf?: string;
  book: BookData;
  library: LibraryData | null;
  access?: { viewability?: string; embeddable?: boolean | null; webReaderLink?: string | null; country?: string | null };
  raw: unknown;
}

interface SeedBook {
  source: string;
  book: BookData;
  library: LibraryData;
  google?: GoogleRecord;
}

interface People {
  /** `email` names the Supabase test user for readers of the file; app_users stores no email. */
  accounts: { key: string; email?: string; supabaseUserId: string; status: 'active' | 'inactive'; roles: string[] }[];
  readers: {
    key: string;
    readerType: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    status: 'active' | 'suspended' | 'inactive';
    account: string | null;
  }[];
}

const GOOGLE_FILE = 'data/seed/books.google.json';
const MANUAL_FILE = 'data/seed/books.manual.json';
const PEOPLE_FILE = 'data/seed/people.json';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Load and validate the seed files; throws on any contract violation (FR-003, FR-025a). */
export function loadSeedBooks(): SeedBook[] {
  const out: SeedBook[] = [];
  if (existsSync(GOOGLE_FILE)) {
    const { books } = readJson<{ books: GoogleRecord[] }>(GOOGLE_FILE);
    const keys = new Set<string>();
    for (const r of books) {
      const key = `${r.provider}:${r.externalId}`;
      if (keys.has(key)) throw new Error(`${GOOGLE_FILE}: duplicate record ${key}`);
      keys.add(key);
      if (r.reviewed !== true) continue;
      if (!r.library) throw new Error(`${GOOGLE_FILE}: reviewed record ${key} has no library data`);
      out.push({ source: key, book: r.book, library: r.library, google: r });
    }
  } else {
    console.warn(`${GOOGLE_FILE} not found: seeding hand-entered books only (run fetch-google-books.ts, then review)`);
  }
  const manual = readJson<{ books: { book: BookData; library: LibraryData }[] }>(MANUAL_FILE);
  manual.books.forEach((r, i) => out.push({ source: `manual#${i + 1}`, ...r }));

  // The same identifier on two records is an error unless the team confirmed distinct editions.
  const byIdent = new Map<string, SeedBook>();
  for (const b of out) {
    for (const id of b.book.identifiers) {
      const k = `${id.type}:${id.value}`;
      const other = byIdent.get(k);
      const confirmed = other && (b.google?.distinctEditionOf === other.google?.externalId
        || other.google?.distinctEditionOf === b.google?.externalId) && b.google && other.google;
      if (other && !confirmed) {
        throw new Error(`identifier ${k} is on ${other.source} and ${b.source}; mark distinctEditionOf or fix the edition`);
      }
      byIdent.set(k, b);
    }
  }
  const barcodes = new Set<string>();
  for (const b of out) {
    for (const c of b.library.copies) {
      if (barcodes.has(c.barcode)) throw new Error(`duplicate copy barcode ${c.barcode}`);
      barcodes.add(c.barcode);
    }
  }
  return out;
}

// ---------------------------------------------------------------- direct inserts (catalog, people)

/** All directly inserted rows carry this creation time so every run is identical (FR-025a). */
const LOADED_AT = vn('2026-07-15 08:00');

async function insertCatalog(conn: PoolConnection, books: SeedBook[]): Promise<Map<SeedBook, number>> {
  const [[mt]] = await conn.query<RowDataPacket[]>(`SELECT id FROM material_types WHERE code = 'BOOK_PRINT'`);
  const publishers = new Map<string, number>();
  const authors = new Map<string, number>();
  const categories = new Map<string, number>();
  const ids = new Map<SeedBook, number>();

  const insertId = async (sql: string, params: unknown[]) => {
    const [res] = await conn.query<mysql.ResultSetHeader>(sql, params);
    return res.insertId;
  };
  const category = async (path: string): Promise<number> => {
    let parent: number | null = null;
    let key = '';
    for (const name of path.split('>').map((s) => s.trim())) {
      key = key ? `${key} > ${name}` : name;
      let id = categories.get(key);
      if (id === undefined) {
        id = await insertId(`INSERT INTO categories (name, parent_id) VALUES (?, ?)`, [name, parent]);
        categories.set(key, id);
      }
      parent = id;
    }
    return parent!;
  };

  for (const b of books) {
    const d = b.book;
    let publisherId: number | null = null;
    if (d.publisher) {
      publisherId = publishers.get(d.publisher) ?? null;
      if (publisherId === null) {
        publisherId = await insertId(`INSERT INTO publishers (name) VALUES (?)`, [d.publisher]);
        publishers.set(d.publisher, publisherId);
      }
    }
    const bookId = await insertId(
      `INSERT INTO books (title, subtitle, publisher_id, published_date_text, published_year, description,
         language_code, cover_url, material_type_id, classification_code, replacement_cost_vnd, status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [d.title, d.subtitle, publisherId, d.publishedDateText, d.publishedYear, d.description, d.languageCode,
        d.coverUrl, mt.id, b.library.classificationCode, b.library.replacementCostVnd, LOADED_AT, LOADED_AT],
    );
    ids.set(b, bookId);
    let order = 1;
    for (const name of d.authors) {
      let authorId = authors.get(name);
      if (authorId === undefined) {
        authorId = await insertId(`INSERT INTO authors (name) VALUES (?)`, [name]);
        authors.set(name, authorId);
      }
      await conn.query(`INSERT INTO book_authors (book_id, author_id, author_order) VALUES (?, ?, ?)`,
        [bookId, authorId, order++]);
    }
    for (const path of d.categories) {
      await conn.query(`INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)`, [bookId, await category(path)]);
    }
    for (const id of d.identifiers) {
      await conn.query(`INSERT INTO book_identifiers (book_id, identifier_type, identifier_value) VALUES (?, ?, ?)`,
        [bookId, id.type, id.value]);
    }
    if (b.google) {
      const g = b.google;
      await conn.query(
        `INSERT INTO book_external_refs (book_id, provider, external_id, source_url, viewability, embeddable,
           web_reader_link, access_country, raw_snapshot, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookId, g.provider, g.externalId, `https://www.googleapis.com/books/v1/volumes/${g.externalId}`,
          g.access?.viewability ?? 'UNKNOWN', g.access?.embeddable ?? null, g.access?.webReaderLink ?? null,
          g.access?.country ?? null, JSON.stringify(g.raw), g.fetchedAt.replace('T', ' ').replace('Z', '')],
      );
    }
  }
  return ids;
}

async function insertPeople(conn: PoolConnection, people: People) {
  const accounts = new Map<string, number>();
  const readers = new Map<string, number>();
  for (const a of people.accounts) {
    const [res] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO app_users (supabase_user_id, status, created_at) VALUES (?, ?, ?)`,
      [a.supabaseUserId, a.status, LOADED_AT],
    );
    accounts.set(a.key, res.insertId);
    for (const role of a.roles) {
      await conn.query(`INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?`,
        [res.insertId, role]);
    }
  }
  for (const r of people.readers) {
    const userId = r.account ? accounts.get(r.account) : null;
    if (userId === undefined) throw new Error(`${PEOPLE_FILE}: reader ${r.key} links unknown account ${r.account}`);
    const [res] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO readers (user_id, reader_type_id, full_name, email, phone, status, created_at)
       SELECT ?, id, ?, ?, ?, ?, ? FROM reader_types WHERE code = ?`,
      [userId, r.fullName, r.email, r.phone, r.status, LOADED_AT, r.readerType],
    );
    if (!res.affectedRows) throw new Error(`${PEOPLE_FILE}: reader ${r.key} has unknown type ${r.readerType}`);
    readers.set(r.key, res.insertId);
  }
  return { accounts, readers };
}

// ---------------------------------------------------------------- scenario (procedures only)

interface Ctx {
  pool: Pool;
  /** Staff accounts: `former` is an inactive librarian account (FORBIDDEN demo). */
  staff: { admin: number; lib1: number; lib2: number; former: number };
  account: (key: string) => number;
  reader: (key: string) => number;
  copy: (barcode: string) => number;
  /** Open loan item and borrower per copy barcode, set by checkout. */
  items: Map<string, { id: number; reader: string }>;
  /** Fines by `reader:barcode:type`, set by return / lost steps. */
  fines: Map<string, { id: number; amount: number }>;
  policies: Map<string, number>;
  /** Current card per reader key, reservation per label, and book id per copy barcode. */
  cards: Map<string, number>;
  reservations: Map<string, number>;
  bookOf: Map<string, number>;
  readerTypes: Map<string, number>;
  materialType: number;
  /** Card numbers are taken in order; a refused issue does not use one up. */
  cardSeq: { n: number };
}

interface Step {
  at: string;
  covers: string;
  run: (ctx: Ctx, now: string) => Promise<string | void>;
}

interface PolicyValues { maxItems: number; loanDays: number; maxRenewals: number; fee: number; debt: number }

/** P0: the opening rules (2026-07-16 to 2026-08-01), replaced by D1 (P1) on 2026-08-01. */
const P0: Record<string, PolicyValues> = {
  STUDENT: { maxItems: 3, loanDays: 10, maxRenewals: 1, fee: 2000, debt: 30_000 },
  LECTURER: { maxItems: 8, loanDays: 30, maxRenewals: 2, fee: 1000, debt: 100_000 },
  EXTERNAL: { maxItems: 2, loanDays: 7, maxRenewals: 0, fee: 5000, debt: 0 },
};

const D1: Record<string, PolicyValues> = {
  STUDENT: { maxItems: 5, loanDays: 14, maxRenewals: 2, fee: 2000, debt: 50_000 },
  LECTURER: { maxItems: 10, loanDays: 30, maxRenewals: 3, fee: 1000, debt: 100_000 },
  EXTERNAL: { maxItems: 3, loanDays: 7, maxRenewals: 1, fee: 5000, debt: 0 },
};

/** Later versions: STUDENT P2 from 2026-10-01, LECTURER P2 from 2026-10-15, EXTERNAL P2 and STUDENT P3 in the future. */
const STUDENT_P2 = { maxItems: 5, loanDays: 7, maxRenewals: 2, fee: 5000, debt: 50_000 };
const LECTURER_P2 = { maxItems: 10, loanDays: 30, maxRenewals: 3, fee: 1500, debt: 150_000 };
const EXTERNAL_P2 = { maxItems: 3, loanDays: 7, maxRenewals: 1, fee: 5000, debt: 20_000 };
const STUDENT_P3 = { maxItems: 5, loanDays: 10, maxRenewals: 2, fee: 3000, debt: 50_000 };

/** Card validity by reader type, from the issue day; a few readers get a short card on purpose. */
const CARD_EXPIRES: Record<string, string> = { STUDENT: '2027-07-15 00:00', LECTURER: '2028-07-15 00:00', EXTERNAL: '2027-01-15 00:00' };
const SHORT_CARDS: Record<string, string> = { S05: '2026-08-31 00:00', S07: '2026-09-15 00:00' };

const call = (ctx: Ctx, name: string, args: unknown[], outParams?: string[]) =>
  callProcedure(ctx.pool, name, args, { outParams });

async function createPolicy(ctx: Ctx, now: string, type: string, label: string, v: PolicyValues, from: string) {
  const { out } = await call(ctx, 'sp_create_policy_version',
    [ctx.staff.admin, now, ctx.readerTypes.get(type), ctx.materialType, v.maxItems, v.loanDays, v.maxRenewals,
      v.fee, v.debt, vn(from)], ['p_policy_id']);
  ctx.policies.set(`${type}:${label}`, Number(out.p_policy_id));
  return `${type} ${label} from ${from}`;
}

async function closePolicy(ctx: Ctx, now: string, key: string, to: string) {
  const id = ctx.policies.get(key);
  if (id === undefined) throw new Error(`scenario: no policy ${key}`);
  await call(ctx, 'sp_close_policy_version', [ctx.staff.admin, now, id, vn(to)]);
  return `${key} closed at ${to}`;
}

async function checkout(ctx: Ctx, now: string, reader: string, barcodes: string[], actor = ctx.staff.lib1) {
  const { rows } = await call(ctx, 'sp_checkout',
    [actor, now, ctx.reader(reader), JSON.stringify(barcodes.map(ctx.copy))]);
  const due: string[] = [];
  for (const r of rows[0] ?? []) {
    const barcode = barcodes[barcodes.map(ctx.copy).indexOf(Number(r.copy_id))];
    ctx.items.set(barcode, { id: Number(r.loan_item_id), reader });
    due.push(`${barcode} due ${r.due_at}`);
  }
  return `${reader} borrows ${due.join(', ')}`;
}

const item = (ctx: Ctx, barcode: string) => {
  const it = ctx.items.get(barcode);
  if (it === undefined) throw new Error(`scenario: ${barcode} is not on loan`);
  return it;
};

function keepFines(ctx: Ctx, label: string, rows: RowDataPacket[]) {
  const parts: string[] = [];
  for (const r of rows) {
    const amount = Number(r.assessed_amount_vnd);
    ctx.fines.set(`${label}:${r.fine_type}`, { id: Number(r.fine_id), amount });
    parts.push(`${r.fine_type} ${amount}`);
  }
  return parts.length ? `fines ${parts.join(', ')}` : 'no fine';
}

async function giveBack(ctx: Ctx, now: string, barcode: string, condition: 'good' | 'worn' | 'damaged' = 'good',
  damagedFine: number | null = null, reason: string | null = null) {
  const it = item(ctx, barcode);
  const { rows } = await call(ctx, 'sp_return_item', [ctx.staff.lib1, now, it.id, condition, damagedFine, reason]);
  ctx.items.delete(barcode);
  return `${barcode} returned ${condition}: ${keepFines(ctx, `${it.reader}:${barcode}`, rows[0] ?? [])}`;
}

async function lost(ctx: Ctx, now: string, barcode: string, lostFine: number | null = null, reason = 'Bạn đọc báo mất') {
  const it = item(ctx, barcode);
  const { rows } = await call(ctx, 'sp_declare_lost', [ctx.staff.lib1, now, it.id, lostFine, reason]);
  ctx.items.delete(barcode);
  return `${barcode} lost: ${keepFines(ctx, `${it.reader}:${barcode}`, rows[0] ?? [])}`;
}

async function renew(ctx: Ctx, now: string, barcode: string) {
  const { out } = await call(ctx, 'sp_renew', [ctx.staff.lib2, now, item(ctx, barcode).id], ['p_new_due_at']);
  return `${barcode} renewed, due ${String(out.p_new_due_at)}`;
}

function fine(ctx: Ctx, label: string) {
  const f = ctx.fines.get(label);
  if (!f) throw new Error(`scenario: no fine ${label}`);
  return f;
}

interface PayOptions { method?: 'cash' | 'bank_transfer'; referenceNo?: string; amount?: number }

async function pay(ctx: Ctx, now: string, reader: string, key: string, allocations: { fine: string; amount?: number }[],
  opts: PayOptions = {}) {
  const alloc = allocations.map((a) => {
    const f = fine(ctx, a.fine);
    return { fine_id: f.id, amount_vnd: a.amount ?? f.amount };
  });
  const amount = opts.amount ?? alloc.reduce((s, a) => s + a.amount_vnd, 0);
  const { out } = await call(ctx, 'sp_record_payment',
    [ctx.staff.lib2, now, ctx.reader(reader), amount, opts.method ?? 'cash', opts.referenceNo ?? null, key,
      JSON.stringify(alloc)],
    ['p_payment_id', 'p_replayed']);
  const replayed = Number(out.p_replayed) === 1 ? ' [replayed: no new payment]' : '';
  return `${reader} pays ${amount} ${opts.method ?? 'cash'} (${alloc.map((a) => a.amount_vnd).join(' + ')})${replayed}`;
}

async function adjust(ctx: Ctx, now: string, label: string, amount: number, reason: string) {
  await call(ctx, 'sp_adjust_fine', [ctx.staff.admin, now, fine(ctx, label).id, amount, reason], ['p_adjustment_id']);
  return `fine ${label} adjusted by ${amount}`;
}

/** A step that must be rejected by a business rule; the rejection is part of the demo. */
async function rejected(key: string, action: Promise<unknown>) {
  try {
    await action;
  } catch (err) {
    if (err instanceof DbRuleError && err.key === key) return `rejected as expected: ${err.message}`;
    throw err;
  }
  throw new Error(`scenario: expected ${key}, but the call succeeded`);
}

/** Reserve the book of `barcode` for `reader`, by staff (default) or by the reader's own account. */
async function reserve(ctx: Ctx, now: string, reader: string, barcode: string, label?: string, actor = ctx.staff.lib1) {
  const book = ctx.bookOf.get(barcode);
  const { out } = await call(ctx, 'sp_reserve', [actor, now, ctx.reader(reader), book], ['p_reservation_id']);
  ctx.reservations.set(label ?? `${reader}:${barcode}`, Number(out.p_reservation_id));
  return `${reader} reserves the book of ${barcode} (reservation ${String(out.p_reservation_id)})`;
}

async function cancelReservation(ctx: Ctx, now: string, label: string, actor: number, reason: string | null) {
  const id = ctx.reservations.get(label);
  if (id === undefined) throw new Error(`scenario: no reservation ${label}`);
  await call(ctx, 'sp_cancel_reservation', [actor, now, id, reason]);
  return `reservation ${label} cancelled`;
}

/** Reservation statuses of a copy's book in queue order, for the log. */
async function queueState(ctx: Ctx, barcode: string) {
  const [rows] = await ctx.pool.query<RowDataPacket[]>(
    `SELECT status FROM reservations WHERE book_id = ? ORDER BY requested_at, id`, [ctx.bookOf.get(barcode)]);
  return rows.length ? `queue: ${rows.map((r) => String(r.status)).join(' / ')}` : 'no queue';
}

async function issueCard(ctx: Ctx, now: string, reader: string, expires: string) {
  const number = `C2026-${String(ctx.cardSeq.n + 1).padStart(4, '0')}`;
  const { out } = await call(ctx, 'sp_issue_card', [ctx.staff.lib1, now, ctx.reader(reader), number, vn(expires)], ['p_card_id']);
  ctx.cardSeq.n += 1;
  ctx.cards.set(reader, Number(out.p_card_id));
  return `${reader} card ${number} until ${expires}`;
}

async function setCard(ctx: Ctx, now: string, reader: string, status: 'expired' | 'lost' | 'revoked') {
  const id = ctx.cards.get(reader);
  if (id === undefined) throw new Error(`scenario: ${reader} has no card`);
  await call(ctx, 'sp_set_card_status', [ctx.staff.lib1, now, id, status]);
  return `${reader} card -> ${status}`;
}

async function copyStatus(ctx: Ctx, now: string, barcode: string, target: 'available' | 'in_repair' | 'retired',
  condition: 'good' | 'worn' | 'damaged') {
  await call(ctx, 'sp_change_copy_status', [ctx.staff.lib1, now, ctx.copy(barcode), target, condition]);
  return `${barcode} -> ${target} (${condition}); ${await queueState(ctx, barcode)}`;
}

const STUDENT_P2_FROM = '2026-10-01 00:00';

/**
 * Scenario steps in local time (UTC+07:00). They run sorted by time. Readers (people.json):
 * S01–S07 STUDENT, L01–L04 LECTURER, E01–E04 EXTERNAL; S04/E04 suspended, S05/L04 inactive.
 * Copies used (data/seed/books.manual.json): M001–M003 Clean Code, M008 Refactoring, M010/M011
 * CLRS 3rd ed., M015/M016 Database System Concepts, M026 DDIA, M029/M030 Computer Networking,
 * M052 Giáo trình CSDL; one-copy books for the queues: M022 SICP, M025 Code Complete,
 * M034 Domain-Driven Design, M062 Tài liệu thực hành SQL;
 * M060/M061 Truyện Kiều (M061 registered damaged, so in repair).
 */
const STEPS: Step[] = [
  // --- policy versions: P0 (opening rules), P1 (D1) from 2026-08-01, later P2/P3 below
  { at: '2026-07-15 11:00', covers: 'policy versions P0', run: async (ctx, now) => {
    const notes = [];
    for (const [type, v] of Object.entries(P0)) notes.push(await createPolicy(ctx, now, type, 'P0', v, '2026-07-16 00:00'));
    return notes.join('; ');
  } },
  { at: '2026-07-15 16:00', covers: 'checkout refused: no policy yet', run: (c, n) =>
    rejected('NO_POLICY', checkout(c, n, 'S02', ['M001'])) },
  { at: '2026-07-25 10:00', covers: 'close P0, create P1 (D1)', run: async (ctx, now) => {
    const notes = [];
    for (const [type, v] of Object.entries(D1)) {
      notes.push(await closePolicy(ctx, now, `${type}:P0`, '2026-08-01 00:00'));
      notes.push(await createPolicy(ctx, now, type, 'P1', v, '2026-08-01 00:00'));
    }
    return notes.join('; ');
  } },
  { at: '2026-07-25 10:30', covers: 'policy refused: overlap', run: (c, n) =>
    rejected('POLICY_OVERLAP', createPolicy(c, n, 'STUDENT', 'X', D1.STUDENT, '2026-09-01 00:00')) },
  { at: '2026-08-05 08:00', covers: 'policy close refused: retroactive', run: (c, n) =>
    rejected('POLICY_CLOSE_REJECTED', closePolicy(c, n, 'STUDENT:P1', '2026-08-02 00:00')) },
  { at: '2026-08-05 08:10', covers: 'librarian cannot manage policies', run: (ctx, now) =>
    rejected('FORBIDDEN', call(ctx, 'sp_create_policy_version',
      [ctx.staff.lib2, now, ctx.readerTypes.get('EXTERNAL'), ctx.materialType, 3, 7, 1, 5000, 0, vn('2026-12-01 00:00')],
      ['p_policy_id'])) },
  { at: '2026-09-25 09:00', covers: 'close STUDENT P1, create P2 (SC-007); LECTURER P2', run: async (ctx, now) => [
    await closePolicy(ctx, now, 'STUDENT:P1', STUDENT_P2_FROM),
    await createPolicy(ctx, now, 'STUDENT', 'P2', STUDENT_P2, STUDENT_P2_FROM),
    await closePolicy(ctx, now, 'LECTURER:P1', '2026-10-15 00:00'),
    await createPolicy(ctx, now, 'LECTURER', 'P2', LECTURER_P2, '2026-10-15 00:00'),
  ].join('; ') },
  { at: '2026-10-10 10:00', covers: 'future versions: EXTERNAL P2, STUDENT P3', run: async (ctx, now) => [
    await closePolicy(ctx, now, 'EXTERNAL:P1', '2026-11-01 00:00'),
    await createPolicy(ctx, now, 'EXTERNAL', 'P2', EXTERNAL_P2, '2026-11-01 00:00'),
    await closePolicy(ctx, now, 'STUDENT:P2', '2027-01-01 00:00'),
    await createPolicy(ctx, now, 'STUDENT', 'P3', STUDENT_P3, '2027-01-01 00:00'),
  ].join('; ') },
  // copies are registered in `run()` at 2026-07-15 09:00 and cards issued at 2026-07-15 10:00

  // --- cards: revoked, lost and replaced, expired by the batch, then renewed
  { at: '2026-07-31 09:00', covers: 'card revoked (lecturer retired)', run: (c, n) => setCard(c, n, 'L04', 'revoked') },
  { at: '2026-08-10 09:00', covers: 'card revoked (reader suspended)', run: (c, n) => setCard(c, n, 'E04', 'revoked') },
  { at: '2026-08-20 16:00', covers: 'card reported lost', run: (c, n) => setCard(c, n, 'S06', 'lost') },
  { at: '2026-08-21 10:00', covers: 'replacement card', run: (c, n) => issueCard(c, n, 'S06', CARD_EXPIRES.STUDENT) },
  { at: '2026-08-21 10:05', covers: 'second active card refused', run: (c, n) =>
    rejected('DUPLICATE', issueCard(c, n, 'S06', CARD_EXPIRES.STUDENT)) },
  { at: '2026-08-21 10:10', covers: 'lost card cannot be reactivated', run: async (ctx, now) => {
    const [[old]] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT id FROM library_cards WHERE reader_id = ? AND status = 'lost'`, [ctx.reader('S06')]);
    return rejected('INVALID_TRANSITION', call(ctx, 'sp_set_card_status', [ctx.staff.lib1, now, old.id, 'active']));
  } },
  { at: '2026-09-16 00:30', covers: 'expired card (sp_expire_cards batch)', run: async (ctx, now) => {
    const { out } = await call(ctx, 'sp_expire_cards', [ctx.staff.admin, now], ['p_count']);
    return `${String(out.p_count)} card(s) expired (S05, S07)`;
  } },
  { at: '2026-09-18 10:00', covers: 'checkout refused: expired card', run: (c, n) =>
    rejected('CARD_INVALID', checkout(c, n, 'S07', ['M030'])) },
  { at: '2026-09-21 10:00', covers: 'new card after expiry', run: (c, n) => issueCard(c, n, 'S07', '2027-09-21 00:00') },

  // --- account and reader status rules
  { at: '2026-08-08 09:00', covers: 'checkout refused: suspended reader', run: (c, n) =>
    rejected('READER_NOT_ACTIVE', checkout(c, n, 'S04', ['M030'])) },
  { at: '2026-08-08 09:30', covers: 'inactive staff account refused', run: (c, n) =>
    rejected('FORBIDDEN', checkout(c, n, 'S03', ['M030'], c.staff.former)) },
  { at: '2026-08-11 09:00', covers: 'reservation refused: suspended reader', run: (c, n) =>
    rejected('READER_NOT_ACTIVE', reserve(c, n, 'E04', 'M026')) },

  // --- S02: a loan under P0 (snapshot kept after P0 closes), renewal limit, late return, bank payment
  { at: '2026-07-20 10:00', covers: 'loan under P0', run: (c, n) => checkout(c, n, 'S02', ['M001']) },
  { at: '2026-07-28 10:00', covers: 'renewal (P0 allows 1)', run: (c, n) => renew(c, n, 'M001') },
  { at: '2026-08-05 09:00', covers: 'renewal refused: limit (P0 snapshot)', run: (c, n) =>
    rejected('RENEWAL_REJECTED', renew(c, n, 'M001')) },
  { at: '2026-08-12 10:00', covers: 'overdue item returned late (P0 fee)', run: (c, n) => giveBack(c, n, 'M001') },
  { at: '2026-08-13 09:00', covers: 'full payment by bank transfer', run: (c, n) =>
    pay(c, n, 'S02', 'SEED-PAY-001', [{ fine: 'S02:M001:late' }], { method: 'bank_transfer', referenceNo: 'VCB-20260813-0001' }) },
  { at: '2026-08-14 09:00', covers: 'payment refused: more than the debt', run: (c, n) =>
    rejected('PAYMENT_EXCEEDS_DEBT', pay(c, n, 'S02', 'SEED-PAY-X01', [{ fine: 'S02:M001:late', amount: 10_000 }])) },
  { at: '2026-08-14 09:30', covers: 'reservation refused: a copy is available', run: (c, n) =>
    rejected('VALIDATION', reserve(c, n, 'S02', 'M001')) },
  { at: '2026-08-20 11:00', covers: 'adjustment refused: below the amount paid', run: (c, n) =>
    rejected('FINE_RULE', adjust(c, n, 'S02:M001:late', -6000, 'Miễn phạt')) },

  // --- S01: a loan with several items, renewals, limit, late and damaged returns, instalments
  { at: '2026-08-05 10:00', covers: 'loan with several items', run: (c, n) => checkout(c, n, 'S01', ['M015', 'M010', 'M026']) },
  { at: '2026-08-06 11:00', covers: 'checkout refused: item limit', run: (c, n) =>
    rejected('LIMIT_REACHED', checkout(c, n, 'S01', ['M008', 'M002', 'M030'])) },
  { at: '2026-08-06 11:05', covers: 'reader with several loans', run: (c, n) => checkout(c, n, 'S01', ['M008']) },
  { at: '2026-08-12 15:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M015') },
  { at: '2026-08-15 09:30', covers: 'damaged return', run: (c, n) =>
    giveBack(c, n, 'M008', 'damaged', 80_000, 'Rách bìa, ướt nửa cuốn') },
  { at: '2026-08-18 09:00', covers: 'renewal (1st)', run: (c, n) => renew(c, n, 'M010') },
  { at: '2026-08-20 10:00', covers: 'fine adjustment (reduce)', run: (c, n) =>
    adjust(c, n, 'S01:M008:damaged', -30_000, 'Đánh giá lại: chỉ rách bìa') },
  { at: '2026-08-25 10:00', covers: 'overdue item returned late', run: (c, n) => giveBack(c, n, 'M026') },
  { at: '2026-08-25 12:00', covers: 'repaired copy back on the shelf', run: (c, n) => copyStatus(c, n, 'M008', 'available', 'worn') },
  { at: '2026-08-28 10:00', covers: 'full payment', run: (c, n) => pay(c, n, 'S01', 'SEED-PAY-002', [{ fine: 'S01:M026:late' }]) },
  { at: '2026-08-28 10:05', covers: 'payment retried with the same key: replayed', run: (c, n) =>
    pay(c, n, 'S01', 'SEED-PAY-002', [{ fine: 'S01:M026:late' }]) },
  { at: '2026-08-28 10:10', covers: 'payment key reused with other values', run: (c, n) =>
    rejected('IDEMPOTENCY_CONFLICT', pay(c, n, 'S01', 'SEED-PAY-002', [{ fine: 'S01:M026:late', amount: 10_000 }])) },
  { at: '2026-08-30 09:00', covers: 'renewal (2nd)', run: (c, n) => renew(c, n, 'M010') },
  { at: '2026-09-01 11:00', covers: 'partial payment (1st instalment)', run: (c, n) =>
    pay(c, n, 'S01', 'SEED-PAY-003', [{ fine: 'S01:M008:damaged', amount: 20_000 }]) },
  { at: '2026-09-05 09:00', covers: 'renewal refused: limit', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M010')) },
  { at: '2026-09-10 11:00', covers: 'renewed item returned worn', run: (c, n) => giveBack(c, n, 'M010', 'worn') },

  // --- L01: overdue item (renewal and checkout refused), lost before due, late-and-lost, instalments
  { at: '2026-08-01 14:00', covers: 'loan', run: (c, n) => checkout(c, n, 'L01', ['M029']) },
  { at: '2026-08-15 09:00', covers: 'lecturer with several items', run: (c, n) => checkout(c, n, 'L01', ['M016', 'M011']) },
  { at: '2026-08-20 09:00', covers: 'renewal (1st of 3)', run: (c, n) => renew(c, n, 'M011') },
  { at: '2026-09-01 09:00', covers: 'renewal (2nd of 3)', run: (c, n) => renew(c, n, 'M011') },
  { at: '2026-09-05 09:10', covers: 'renewal refused: overdue', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M029')) },
  { at: '2026-09-05 10:00', covers: 'checkout refused: overdue item', run: (c, n) =>
    rejected('OVERDUE_BLOCKED', checkout(c, n, 'L01', ['M030'])) },
  { at: '2026-09-05 15:00', covers: 'lost before due (fine below replacement cost)', run: (c, n) =>
    lost(c, n, 'M016', 900_000, 'Bạn đọc báo mất; bản cũ, giảm theo khấu hao') },
  { at: '2026-09-06 10:00', covers: 'fine adjustment (increase)', run: (c, n) =>
    adjust(c, n, 'L01:M016:lost', 50_000, 'Bổ sung phí xử lý tài liệu mất') },
  { at: '2026-09-10 09:00', covers: 'renewal (3rd of 3)', run: (c, n) => renew(c, n, 'M011') },
  { at: '2026-09-10 10:00', covers: 'late-and-lost', run: (c, n) => lost(c, n, 'M029') },
  { at: '2026-09-11 10:00', covers: 'fine adjustment (holiday)', run: (c, n) =>
    adjust(c, n, 'L01:M029:late', -5000, 'Trừ ngày nghỉ lễ 02/09') },
  { at: '2026-09-12 10:00', covers: 'partial payment across two fines', run: (c, n) =>
    pay(c, n, 'L01', 'SEED-PAY-004', [{ fine: 'L01:M029:late', amount: 5000 }, { fine: 'L01:M029:lost', amount: 100_000 }]) },
  { at: '2026-09-12 16:00', covers: 'item renewed 3 times returned on time', run: (c, n) => giveBack(c, n, 'M011') },
  { at: '2026-09-15 10:00', covers: 'fine adjustment (partial waiver)', run: (c, n) =>
    adjust(c, n, 'L01:M029:lost', -200_000, 'Bạn đọc nộp lại bản cùng ấn bản đã qua sử dụng') },
  { at: '2026-09-20 09:00', covers: 'fine adjustment (second on one fine)', run: (c, n) =>
    adjust(c, n, 'L01:M016:lost', -150_000, 'Giảm theo quyết định của trưởng thư viện') },
  { at: '2026-09-20 10:00', covers: 'partial payment by bank transfer', run: (c, n) =>
    pay(c, n, 'L01', 'SEED-PAY-005', [{ fine: 'L01:M016:lost', amount: 400_000 }],
      { method: 'bank_transfer', referenceNo: 'BIDV-20260920-0042' }) },
  { at: '2026-10-01 10:00', covers: 'payment settles one fine, part of another', run: (c, n) =>
    pay(c, n, 'L01', 'SEED-PAY-006', [{ fine: 'L01:M016:lost', amount: 400_000 }, { fine: 'L01:M029:lost', amount: 100_000 }],
      { method: 'bank_transfer', referenceNo: 'BIDV-20261001-0007' }) },

  // --- E01: late fee capped at the replacement cost; debt block; US4-14 fine paid next month
  { at: '2026-09-01 10:00', covers: 'loan', run: (c, n) => checkout(c, n, 'E01', ['M062']) },
  { at: '2026-09-22 09:00', covers: 'late return, fee capped at replacement cost', run: (c, n) => giveBack(c, n, 'M062') },
  { at: '2026-09-23 10:00', covers: 'checkout refused: debt', run: (c, n) => rejected('DEBT_BLOCKED', checkout(c, n, 'E01', ['M030'])) },
  { at: '2026-09-24 10:00', covers: 'fine adjustment (closed days)', run: (c, n) =>
    adjust(c, n, 'E01:M062:late', -10_000, 'Trừ 2 ngày thư viện đóng cửa') },
  { at: '2026-09-25 10:00', covers: 'payment refused: allocations do not match', run: (c, n) =>
    rejected('ALLOCATION_MISMATCH', pay(c, n, 'E01', 'SEED-PAY-X02', [{ fine: 'E01:M062:late', amount: 30_000 }], { amount: 35_000 })) },
  { at: '2026-09-25 10:05', covers: 'partial payment', run: (c, n) =>
    pay(c, n, 'E01', 'SEED-PAY-007', [{ fine: 'E01:M062:late', amount: 30_000 }]) },
  { at: '2026-10-03 10:00', covers: 'US4-14 paid next month', run: (c, n) =>
    pay(c, n, 'E01', 'SEED-PAY-008', [{ fine: 'E01:M062:late', amount: 20_000 }]) },

  // --- US2-10 boundary (S01) and a second renewal under the P1 snapshot
  { at: '2026-09-30 09:00', covers: 'copy retired', run: (c, n) => copyStatus(c, n, 'M052', 'retired', 'worn') },
  { at: '2026-09-30 23:59:59.900', covers: 'US2-10 checkout just before P1 ends', run: (c, n) => checkout(c, n, 'S01', ['M002']) },
  { at: '2026-10-01 00:00:00.100', covers: 'US2-10 checkout under P2', run: (c, n) => checkout(c, n, 'S01', ['M003']) },
  { at: '2026-10-07 11:00', covers: 'on-time return (P2 due date)', run: (c, n) => giveBack(c, n, 'M003') },
  { at: '2026-10-10 11:00', covers: 'renewal under the P1 snapshot', run: (c, n) => renew(c, n, 'M002') },
  { at: '2026-10-10 14:00', covers: 'final instalment', run: (c, n) =>
    pay(c, n, 'S01', 'SEED-PAY-009', [{ fine: 'S01:M008:damaged', amount: 30_000 }]) },
  { at: '2026-10-12 09:00', covers: 'second renewal', run: (c, n) => renew(c, n, 'M002') },

  // --- [Ext] Code Complete queue: renewal refused, ineligible head, reader cancels a ready hold
  { at: '2026-08-10 10:00', covers: 'loan of a one-copy book', run: (c, n) => checkout(c, n, 'L02', ['M025']) },
  { at: '2026-09-01 09:30', covers: 'renewal', run: (c, n) => renew(c, n, 'M025') },
  { at: '2026-09-02 10:00', covers: 'Ext: reservation (queue 1st; card expires later)', run: (c, n) => reserve(c, n, 'S07', 'M025') },
  { at: '2026-09-03 20:00', covers: 'Ext: reader reserves with own account', run: (c, n) =>
    reserve(c, n, 'S02', 'M025', undefined, c.account('s02')) },
  { at: '2026-09-04 10:00', covers: 'Ext: reservation (queue 3rd)', run: (c, n) => reserve(c, n, 'E02', 'M025') },
  { at: '2026-09-04 10:05', covers: 'Ext: second reservation refused', run: (c, n) =>
    rejected('DUPLICATE', reserve(c, n, 'S02', 'M025', 'dup', c.account('s02'))) },
  { at: '2026-09-04 10:10', covers: "Ext: reader cannot reserve for another reader", run: (c, n) =>
    rejected('FORBIDDEN', reserve(c, n, 'S06', 'M025', 'other', c.account('s02'))) },
  { at: '2026-09-15 10:00', covers: 'Ext: renewal refused: reserved', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M025')) },
  { at: '2026-09-20 15:00', covers: 'Ext: return skips the ineligible head', run: async (ctx, now) =>
    `${await giveBack(ctx, now, 'M025')}; ${await queueState(ctx, 'M025')}` },
  { at: '2026-09-21 09:00', covers: 'Ext: reader cancels a ready hold', run: async (ctx, now) =>
    `${await cancelReservation(ctx, now, 'S02:M025', ctx.account('s02'), null)}; ${await queueState(ctx, 'M025')}` },
  { at: '2026-09-22 10:00', covers: 'Ext: holder collects: reservation fulfilled', run: (c, n) => checkout(c, n, 'E02', ['M025']) },
  { at: '2026-09-26 10:00', covers: 'renewal (EXTERNAL allows 1)', run: (c, n) => renew(c, n, 'M025') },
  { at: '2026-10-08 10:00', covers: 'damaged fine refused: above replacement cost', run: (c, n) =>
    rejected('FINE_RULE', giveBack(c, n, 'M025', 'damaged', 700_000, 'Gãy gáy sách')) },
  { at: '2026-10-08 10:05', covers: 'late and damaged return', run: (c, n) =>
    giveBack(c, n, 'M025', 'damaged', 50_000, 'Gãy gáy sách, bong trang') },
  { at: '2026-10-09 09:00', covers: 'fine waived in full', run: (c, n) =>
    adjust(c, n, 'E02:M025:late', -10_000, 'Miễn phạt trễ: bạn đọc báo trước qua email') },
  { at: '2026-10-09 09:10', covers: 'fine adjustment (increase after inspection)', run: (c, n) =>
    adjust(c, n, 'E02:M025:damaged', 20_000, 'Kiểm tra lại: hư hỏng nặng hơn ghi nhận') },
  { at: '2026-10-10 09:00', covers: 'fine adjustment (appeal)', run: (c, n) =>
    adjust(c, n, 'E02:M025:damaged', -30_000, 'Khiếu nại được chấp nhận một phần') },
  { at: '2026-10-11 10:00', covers: 'payment (1st of 2)', run: (c, n) =>
    pay(c, n, 'E02', 'SEED-PAY-010', [{ fine: 'E02:M025:damaged', amount: 20_000 }]) },
  { at: '2026-10-12 16:00', covers: 'payment (2nd of 2)', run: (c, n) =>
    pay(c, n, 'E02', 'SEED-PAY-011', [{ fine: 'E02:M025:damaged', amount: 20_000 }],
      { method: 'bank_transfer', referenceNo: 'MB-20261012-0311' }) },

  // --- [Ext] SICP queue: a soft-blocked holder whose hold expires, then a fulfilment
  { at: '2026-10-03 11:00', covers: 'loan of a one-copy book', run: (c, n) => checkout(c, n, 'E01', ['M022']) },
  { at: '2026-10-03 12:00', covers: 'Ext: reservation (queue 1st, blocked by debt)', run: (c, n) => reserve(c, n, 'L01', 'M022') },
  { at: '2026-10-03 12:05', covers: 'Ext: reservation (queue 2nd)', run: (c, n) => reserve(c, n, 'S01', 'M022') },
  { at: '2026-10-04 10:00', covers: 'Ext: renewal refused: reserved', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M022')) },
  { at: '2026-10-05 15:00', covers: 'Ext: return promotes the queue', run: async (ctx, now) =>
    `${await giveBack(ctx, now, 'M022')}; ${await queueState(ctx, 'M022')}` },
  { at: '2026-10-06 10:00', covers: 'Ext: soft-blocked holder cannot collect', run: (c, n) =>
    rejected('DEBT_BLOCKED', checkout(c, n, 'L01', ['M022'])) },
  { at: '2026-10-06 11:00', covers: 'Ext: copy held for another reader', run: (c, n) =>
    rejected('COPY_NOT_AVAILABLE', checkout(c, n, 'S02', ['M022'])) },
  { at: '2026-10-08 16:00', covers: 'Ext: expired hold passes to the next reader', run: async (ctx, now) => {
    const { out } = await call(ctx, 'sp_expire_holds', [ctx.staff.admin, now], ['p_count']);
    return `${String(out.p_count)} hold(s) expired; ${await queueState(ctx, 'M022')}`;
  } },
  { at: '2026-10-09 09:30', covers: 'Ext: holder collects: reservation fulfilled', run: (c, n) => checkout(c, n, 'S01', ['M022']) },

  // --- [Ext] SQL handout queue: staff cancel, then a late return leaves a ready hold
  { at: '2026-10-01 09:00', covers: 'loan under STUDENT P2', run: (c, n) => checkout(c, n, 'S03', ['M062']) },
  { at: '2026-10-02 10:00', covers: 'Ext: reservation (stays ready)', run: (c, n) => reserve(c, n, 'L03', 'M062') },
  { at: '2026-10-02 10:30', covers: 'Ext: reservation', run: (c, n) => reserve(c, n, 'E03', 'M062') },
  { at: '2026-10-03 09:00', covers: 'Ext: staff cancels with a reason', run: (c, n) =>
    cancelReservation(c, n, 'E03:M062', c.staff.lib1, 'Bạn đọc gọi điện hủy') },
  { at: '2026-10-12 10:00', covers: 'late return (P2 fee) promotes the queue', run: async (ctx, now) =>
    `${await giveBack(ctx, now, 'M062')}; ${await queueState(ctx, 'M062')}` },
  { at: '2026-10-12 11:00', covers: 'fine adjustment; fine left unpaid', run: (c, n) =>
    adjust(c, n, 'S03:M062:late', -5000, 'Giảm 1 ngày do lỗi hệ thống nhắc hạn') },

  // --- [Ext] Truyện Kiều and Domain-Driven Design: repaired copy promotes the queue; waiting reservations at the end
  { at: '2026-10-05 10:00', covers: 'loan with several items', run: (c, n) => checkout(c, n, 'L02', ['M060', 'M034']) },
  { at: '2026-10-06 09:00', covers: 'Ext: reservation while the other copy is in repair', run: (c, n) => reserve(c, n, 'S06', 'M060') },
  { at: '2026-10-07 09:00', covers: 'renewal', run: (c, n) => renew(c, n, 'M034') },
  { at: '2026-10-07 10:00', covers: 'Ext: reader reserves with own account', run: (c, n) =>
    reserve(c, n, 'S02', 'M034', undefined, c.account('s02')) },
  { at: '2026-10-09 10:00', covers: 'Ext: reader with debt may still queue (stays waiting)', run: (c, n) => reserve(c, n, 'E02', 'M060') },
  { at: '2026-10-09 11:00', covers: 'Ext: reader cancels a waiting reservation', run: (c, n) =>
    cancelReservation(c, n, 'S02:M034', c.account('s02'), 'Đã mượn được bản điện tử') },
  { at: '2026-10-10 15:00', covers: 'Ext: reservation (stays waiting)', run: (c, n) => reserve(c, n, 'S03', 'M034') },
  { at: '2026-10-12 14:00', covers: 'Ext: repaired copy goes to the queue head', run: (c, n) => copyStatus(c, n, 'M061', 'available', 'worn') },
  { at: '2026-10-12 15:00', covers: 'Ext: renewal refused: reserved', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M060')) },
];

const localTime = (at: string) => (at.length === 16 ? `${at}:00.000` : at);

async function run() {
  const args = process.argv.slice(2);
  const schema = schemaFromArgs(args);
  const common = { timezone: 'Z', dateStrings: true, supportBigNumbers: true } as const;
  const pool = mysql.createPool({ ...dbConfig('app', { schema }), ...common, connectionLimit: 4 });
  const owner = await mysql.createConnection({ ...dbConfig('owner', { schema }), ...common });

  try {
    const books = loadSeedBooks();
    const people = readJson<People>(PEOPLE_FILE);

    // FR-025a: only on an empty schema, or after an explicit reset.
    const nonEmpty: string[] = [];
    for (const t of await dataTables(owner)) {
      const [[r]] = await owner.query<RowDataPacket[]>(`SELECT EXISTS (SELECT 1 FROM \`${t}\`) AS has_rows`);
      if (Number(r.has_rows)) nonEmpty.push(t);
    }
    if (nonEmpty.length) {
      if (!args.includes('--reset')) {
        throw new Error(`${schema} already has data (${nonEmpty.join(', ')}); pass --reset to empty it first`);
      }
      await truncateData(owner);
      console.log(`reset: emptied ${nonEmpty.length} tables in ${schema}`);
    }

    // Direct inserts (FR-025b allows catalog and people data), one transaction.
    const conn = await pool.getConnection();
    let bookIds: Map<SeedBook, number>;
    let accounts: Map<string, number>;
    let readerIds: Map<string, number>;
    try {
      await conn.beginTransaction();
      bookIds = await insertCatalog(conn, books);
      ({ accounts, readers: readerIds } = await insertPeople(conn, people));
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    console.log(`catalog: ${books.length} books; people: ${accounts.size} accounts, ${readerIds.size} readers`);

    const [types] = await owner.query<RowDataPacket[]>(`SELECT id, code FROM reader_types`);
    const [[mt]] = await owner.query<RowDataPacket[]>(`SELECT id FROM material_types WHERE code = 'BOOK_PRINT'`);
    const accountId = (key: string) => {
      const id = accounts.get(key);
      if (id === undefined) throw new Error(`${PEOPLE_FILE}: account ${key} is missing`);
      return id;
    };
    const copies = new Map<string, number>();
    const ctx: Ctx = {
      pool,
      // Checkouts, returns and cards by one librarian; renewals and payments by the other.
      staff: { admin: accountId('admin'), lib1: accountId('librarian'), lib2: accountId('librarian2'),
        former: accountId('librarian_old') },
      account: accountId,
      reader: (key) => {
        const id = readerIds.get(key);
        if (id === undefined) throw new Error(`scenario: unknown reader ${key}`);
        return id;
      },
      copy: (barcode) => {
        const id = copies.get(barcode);
        if (id === undefined) throw new Error(`scenario: unknown copy ${barcode}`);
        return id;
      },
      items: new Map(),
      fines: new Map(),
      policies: new Map(),
      cards: new Map(),
      reservations: new Map(),
      bookOf: new Map(),
      readerTypes: new Map(types.map((t) => [String(t.code), Number(t.id)])),
      materialType: Number(mt.id),
      cardSeq: { n: 0 },
    };

    const steps: Step[] = [
      ...STEPS,
      { at: '2026-07-15 09:00', covers: 'copies registered (sp_register_copy)', run: async (c, now) => {
        for (const b of books) {
          for (const cp of b.library.copies) {
            const { out } = await call(c, 'sp_register_copy',
              [c.staff.lib1, now, bookIds.get(b), cp.barcode, cp.shelfCode, '2026-07-15', cp.condition], ['p_copy_id']);
            copies.set(cp.barcode, Number(out.p_copy_id));
            c.bookOf.set(cp.barcode, bookIds.get(b)!);
          }
        }
        return `${copies.size} copies`;
      } },
      // Every reader got a card when enrolled; suspended and inactive readers keep theirs until
      // a card step changes it. S05 and S07 get short cards that the expiry batch closes.
      { at: '2026-07-15 10:00', covers: 'cards issued', run: async (c, now) => {
        for (const r of people.readers) {
          await issueCard(c, now, r.key, SHORT_CARDS[r.key] ?? CARD_EXPIRES[r.readerType]);
        }
        return `${people.readers.length} cards`;
      } },
    ];
    steps.sort((a, b) => localTime(a.at).localeCompare(localTime(b.at)));

    for (const step of steps) {
      const note = await step.run(ctx, vn(step.at));
      console.log(`${step.at.padEnd(23)} [${step.covers}] ${note ?? ''}`);
    }

    // The invariant suite runs as the app account, like `pnpm db:check`.
    const app = await pool.getConnection();
    let violations: Awaited<ReturnType<typeof findViolations>>;
    try {
      violations = await findViolations(app);
    } finally {
      app.release();
    }
    for (const v of violations) console.error(`  ${v.view}:`, v.rows);
    if (violations.length) throw new Error(`invariant suite: ${violations.length} view(s) with violations`);
    console.log(`${schema}: seeded; invariant suite clean`);
  } finally {
    await owner.end();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
