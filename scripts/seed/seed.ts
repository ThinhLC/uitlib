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
  accounts: { key: string; supabaseUserId: string; status: 'active' | 'inactive'; roles: string[] }[];
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
  staff: { admin: number; lib1: number; lib2: number };
  reader: (key: string) => number;
  copy: (barcode: string) => number;
  /** Open loan item per copy barcode, set by checkout. */
  items: Map<string, number>;
  /** Fines by label, set by return / lost steps. */
  fines: Map<string, { id: number; amount: number }>;
  policies: Map<string, number>;
  /** Card id per reader key, and book id per copy barcode (set by the setup steps). */
  cards: Map<string, number>;
  bookOf: Map<string, number>;
  readerTypes: Map<string, number>;
  materialType: number;
}

interface Step {
  at: string;
  covers: string;
  run: (ctx: Ctx, now: string) => Promise<string | void>;
}

const D1 = {
  STUDENT: { maxItems: 5, loanDays: 14, maxRenewals: 2, fee: 2000, debt: 50_000, cardMonths: 12 },
  LECTURER: { maxItems: 10, loanDays: 30, maxRenewals: 3, fee: 1000, debt: 100_000, cardMonths: 24 },
  EXTERNAL: { maxItems: 3, loanDays: 7, maxRenewals: 1, fee: 5000, debt: 0, cardMonths: 6 },
} as const;

const call = (ctx: Ctx, name: string, args: unknown[], outParams?: string[]) =>
  callProcedure(ctx.pool, name, args, { outParams });

async function checkout(ctx: Ctx, now: string, reader: string, barcodes: string[]) {
  const { rows } = await call(ctx, 'sp_checkout',
    [ctx.staff.lib1, now, ctx.reader(reader), JSON.stringify(barcodes.map(ctx.copy))]);
  const due: string[] = [];
  for (const r of rows[0] ?? []) {
    const barcode = barcodes[barcodes.map(ctx.copy).indexOf(Number(r.copy_id))];
    ctx.items.set(barcode, Number(r.loan_item_id));
    due.push(`${barcode} due ${r.due_at}`);
  }
  return `${reader} borrows ${due.join(', ')}`;
}

const item = (ctx: Ctx, barcode: string) => {
  const id = ctx.items.get(barcode);
  if (id === undefined) throw new Error(`scenario: ${barcode} is not on loan`);
  return id;
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
  const { rows } = await call(ctx, 'sp_return_item', [ctx.staff.lib1, now, item(ctx, barcode), condition, damagedFine, reason]);
  ctx.items.delete(barcode);
  return `${barcode} returned ${condition}: ${keepFines(ctx, barcode, rows[0] ?? [])}`;
}

async function lost(ctx: Ctx, now: string, barcode: string) {
  const { rows } = await call(ctx, 'sp_declare_lost', [ctx.staff.lib1, now, item(ctx, barcode), null, 'Bạn đọc báo mất']);
  ctx.items.delete(barcode);
  return `${barcode} lost: ${keepFines(ctx, barcode, rows[0] ?? [])}`;
}

async function renew(ctx: Ctx, now: string, barcode: string) {
  const { out } = await call(ctx, 'sp_renew', [ctx.staff.lib2, now, item(ctx, barcode)], ['p_new_due_at']);
  return `${barcode} renewed, due ${String(out.p_new_due_at)}`;
}

function fine(ctx: Ctx, label: string) {
  const f = ctx.fines.get(label);
  if (!f) throw new Error(`scenario: no fine ${label}`);
  return f;
}

async function pay(ctx: Ctx, now: string, reader: string, key: string, allocations: { fine: string; amount?: number }[]) {
  const alloc = allocations.map((a) => {
    const f = fine(ctx, a.fine);
    return { fine_id: f.id, amount_vnd: a.amount ?? f.amount };
  });
  const amount = alloc.reduce((s, a) => s + a.amount_vnd, 0);
  await call(ctx, 'sp_record_payment',
    [ctx.staff.lib2, now, ctx.reader(reader), amount, 'cash', null, key, JSON.stringify(alloc)],
    ['p_payment_id', 'p_replayed']);
  return `${reader} pays ${amount} (${alloc.map((a) => a.amount_vnd).join(' + ')})`;
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

async function reserve(ctx: Ctx, now: string, reader: string, barcode: string) {
  const book = ctx.bookOf.get(barcode);
  const { out } = await call(ctx, 'sp_reserve', [ctx.staff.lib1, now, ctx.reader(reader), book], ['p_reservation_id']);
  return `${reader} reserves the book of ${barcode} (reservation ${String(out.p_reservation_id)})`;
}

/** Reservation statuses of a copy's book in queue order, for the log. */
async function queueState(ctx: Ctx, barcode: string) {
  const [rows] = await ctx.pool.query<RowDataPacket[]>(
    `SELECT status FROM reservations WHERE book_id = ? ORDER BY requested_at, id`, [ctx.bookOf.get(barcode)]);
  return `queue: ${rows.map((r) => String(r.status)).join(' / ')}`;
}

const STUDENT_P2_FROM = '2026-10-01 00:00';

/** Scenario steps in local time (UTC+07:00). They run sorted by time. */
const STEPS: Step[] = [
  // --- setup
  { at: '2026-08-01 08:00', covers: 'policy versions (D1)', run: async (ctx, now) => {
    for (const [type, v] of Object.entries(D1)) {
      const { out } = await call(ctx, 'sp_create_policy_version',
        [ctx.staff.admin, now, ctx.readerTypes.get(type), ctx.materialType, v.maxItems, v.loanDays, v.maxRenewals,
          v.fee, v.debt, vn('2026-08-01 00:00')], ['p_policy_id']);
      ctx.policies.set(`${type}:P1`, Number(out.p_policy_id));
    }
    return 'STUDENT, LECTURER, EXTERNAL from 2026-08-01';
  } },
  // copies are registered in `run()` at 2026-08-01 09:00
  // cards are issued in `run()` at 2026-08-01 10:00

  // --- on-time loan
  { at: '2026-08-03 09:00', covers: 'on-time loan', run: (c, n) => checkout(c, n, 'S01', ['M001']) },
  { at: '2026-08-14 10:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M001') },

  // --- one loan with several items; one reader with several loans
  { at: '2026-08-05 10:00', covers: 'loan with several items', run: (c, n) => checkout(c, n, 'S02', ['M015', 'M019', 'M026']) },
  { at: '2026-08-12 15:00', covers: 'item returned on time', run: (c, n) => giveBack(c, n, 'M015') },
  { at: '2026-08-18 09:00', covers: 'renewal (1st)', run: (c, n) => renew(c, n, 'M019') },
  { at: '2026-08-25 16:00', covers: 'overdue item returned late', run: (c, n) => giveBack(c, n, 'M026') },
  { at: '2026-08-28 10:00', covers: 'full payment', run: (c, n) => pay(c, n, 'S02', 'SEED-PAY-001', [{ fine: 'M026:late' }]) },
  { at: '2026-08-30 09:00', covers: 'renewal (2nd)', run: (c, n) => renew(c, n, 'M019') },
  { at: '2026-09-05 09:00', covers: 'renewal refused: limit', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M019')) },
  { at: '2026-09-10 11:00', covers: 'renewed item returned', run: (c, n) => giveBack(c, n, 'M019') },
  { at: '2026-09-15 14:00', covers: 'reader with several loans', run: (c, n) => checkout(c, n, 'S02', ['M027']) },

  // --- damaged return and adjustment
  { at: '2026-08-06 11:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S03', ['M008']) },
  { at: '2026-08-15 09:30', covers: 'damaged return', run: (c, n) =>
    giveBack(c, n, 'M008', 'damaged', 80_000, 'Rách bìa, ướt nửa cuốn') },
  { at: '2026-08-20 10:00', covers: 'fine adjustment', run: async (ctx, now) => {
    await call(ctx, 'sp_adjust_fine',
      [ctx.staff.admin, now, fine(ctx, 'M008:damaged').id, -30_000, 'Đánh giá lại: chỉ rách bìa'], ['p_adjustment_id']);
    return 'damaged fine M008 adjusted by -30000';
  } },

  // --- late-and-lost, then partial payment across two fines
  { at: '2026-08-01 14:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S04', ['M010']) },
  { at: '2026-09-10 10:00', covers: 'late-and-lost', run: (c, n) => lost(c, n, 'M010') },
  { at: '2026-09-12 10:00', covers: 'partial payment across two fines', run: (c, n) =>
    pay(c, n, 'S04', 'SEED-PAY-002', [{ fine: 'M010:late' }, { fine: 'M010:lost', amount: 100_000 }]) },

  // --- lost before due; a lecturer with several items
  { at: '2026-08-15 09:00', covers: 'loan', run: (c, n) => checkout(c, n, 'L01', ['M029', 'M031']) },
  { at: '2026-09-05 15:00', covers: 'lost before due', run: (c, n) => lost(c, n, 'M029') },
  { at: '2026-09-12 16:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M031') },

  // --- US4-14: fine assessed in September, paid in October
  { at: '2026-08-25 10:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S06', ['M004']) },
  { at: '2026-09-20 09:00', covers: 'late return (September fine)', run: (c, n) => giveBack(c, n, 'M004') },
  { at: '2026-10-03 10:00', covers: 'US4-14 paid next month', run: (c, n) => pay(c, n, 'S06', 'SEED-PAY-003', [{ fine: 'M004:late' }]) },

  // --- expired card
  { at: '2026-09-01 09:30', covers: 'loan', run: (c, n) => checkout(c, n, 'E04', ['M044']) },
  { at: '2026-09-07 17:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M044') },
  { at: '2026-09-20 00:05', covers: 'expired card (sp_expire_cards cursor)', run: async (ctx, now) => {
    const { out } = await call(ctx, 'sp_expire_cards', [ctx.staff.admin, now], ['p_count']);
    return `${String(out.p_count)} card(s) expired`;
  } },
  { at: '2026-09-21 10:00', covers: 'checkout refused: expired card', run: (c, n) =>
    rejected('CARD_INVALID', checkout(c, n, 'E04', ['M045'])) },

  // --- debt block (EXTERNAL: any debt blocks)
  { at: '2026-09-01 10:00', covers: 'loan', run: (c, n) => checkout(c, n, 'E01', ['M046']) },
  { at: '2026-09-10 10:00', covers: 'late return', run: (c, n) => giveBack(c, n, 'M046') },
  { at: '2026-09-12 11:00', covers: 'checkout refused: debt', run: (c, n) =>
    rejected('DEBT_BLOCKED', checkout(c, n, 'E01', ['M048'])) },

  // --- item still overdue; renewal refused
  { at: '2026-09-01 11:00', covers: 'overdue item (still on loan)', run: (c, n) => checkout(c, n, 'S09', ['M023']) },
  { at: '2026-09-18 09:00', covers: 'renewal refused: overdue', run: (c, n) => rejected('RENEWAL_REJECTED', renew(c, n, 'M023')) },

  // --- everyday circulation (reports)
  { at: '2026-08-10 09:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S07', ['M002', 'M037']) },
  { at: '2026-08-20 15:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M002') },
  { at: '2026-08-21 15:00', covers: 'on-time return (worn)', run: (c, n) => giveBack(c, n, 'M037', 'worn') },
  { at: '2026-08-16 10:00', covers: 'loan', run: (c, n) => checkout(c, n, 'L03', ['M035', 'M039']) },
  { at: '2026-08-30 10:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M035') },
  { at: '2026-08-30 10:01', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M039') },
  { at: '2026-08-21 09:00', covers: 'loan', run: (c, n) => checkout(c, n, 'L02', ['M002', 'M041']) },
  { at: '2026-09-10 16:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M002') },
  { at: '2026-09-10 16:01', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M041') },
  { at: '2026-09-15 09:00', covers: 'reader with several loans', run: (c, n) => checkout(c, n, 'L02', ['M001']) },
  { at: '2026-08-22 10:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S08', ['M001', 'M012']) },
  { at: '2026-09-02 10:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M001') },
  { at: '2026-09-02 10:01', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M012') },
  { at: '2026-09-03 13:00', covers: 'loan', run: (c, n) => checkout(c, n, 'S10', ['M003', 'M051']) },
  { at: '2026-09-12 13:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M003') },
  { at: '2026-09-12 13:01', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M051') },
  { at: '2026-09-05 08:30', covers: 'loan', run: (c, n) => checkout(c, n, 'S11', ['M047', 'M055']) },
  { at: '2026-09-15 08:30', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M047') },
  { at: '2026-09-02 14:00', covers: 'loan (still on loan)', run: (c, n) => checkout(c, n, 'L04', ['M042']) },
  { at: '2026-09-08 09:00', covers: 'loan', run: (c, n) => checkout(c, n, 'L05', ['M052', 'M056']) },
  { at: '2026-09-22 09:00', covers: 'on-time return', run: (c, n) => giveBack(c, n, 'M052') },

  // --- policy change and the US2-10 boundary
  { at: '2026-09-25 09:00', covers: 'close STUDENT P1, create P2 (SC-007)', run: async (ctx, now) => {
    const p1 = ctx.policies.get('STUDENT:P1')!;
    await call(ctx, 'sp_close_policy_version', [ctx.staff.admin, now, p1, vn(STUDENT_P2_FROM)]);
    const v = D1.STUDENT;
    const { out } = await call(ctx, 'sp_create_policy_version',
      [ctx.staff.admin, now, ctx.readerTypes.get('STUDENT'), ctx.materialType, v.maxItems, 7, v.maxRenewals,
        5000, v.debt, vn(STUDENT_P2_FROM)], ['p_policy_id']);
    ctx.policies.set('STUDENT:P2', Number(out.p_policy_id));
    return 'STUDENT P2 from 2026-10-01: 7 days, 5000/day';
  } },
  { at: '2026-09-30 23:59:59.900', covers: 'US2-10 checkout just before P1 ends', run: (c, n) => checkout(c, n, 'S05', ['M005']) },
  { at: '2026-10-01 00:00:00.100', covers: 'US2-10 checkout under P2', run: (c, n) => checkout(c, n, 'S12', ['M006']) },

  // --- [Ext] reservation queue: an ineligible head, a soft-blocked holder whose hold expires, a fulfilment
  { at: '2026-10-02 09:00', covers: 'loan of a one-copy book', run: (c, n) => checkout(c, n, 'L03', ['M022']) },
  { at: '2026-10-03 09:00', covers: 'Ext: reservation (queue 1st)', run: (c, n) => reserve(c, n, 'E02', 'M022') },
  { at: '2026-10-03 09:05', covers: 'Ext: reservation (queue 2nd, has an overdue item)', run: (c, n) => reserve(c, n, 'S11', 'M022') },
  { at: '2026-10-03 09:10', covers: 'Ext: reservation (queue 3rd)', run: (c, n) => reserve(c, n, 'S08', 'M022') },
  { at: '2026-10-04 10:00', covers: 'Ext: renewal refused: reserved', run: (c, n) =>
    rejected('RENEWAL_REJECTED', renew(c, n, 'M022')) },
  { at: '2026-10-04 11:00', covers: 'card revoked (queue head becomes ineligible)', run: async (ctx, now) => {
    await call(ctx, 'sp_set_card_status', [ctx.staff.lib1, now, ctx.cards.get('E02'), 'revoked']);
    return 'E02 card revoked';
  } },
  { at: '2026-10-05 15:00', covers: 'Ext: return promotes the queue', run: async (ctx, now) =>
    `${await giveBack(ctx, now, 'M022')}; ${await queueState(ctx, 'M022')}` },
  { at: '2026-10-06 10:00', covers: 'Ext: soft-blocked holder cannot collect', run: (c, n) =>
    rejected('OVERDUE_BLOCKED', checkout(c, n, 'S11', ['M022'])) },
  { at: '2026-10-08 15:00', covers: 'Ext: expired hold passes to the next reader', run: async (ctx, now) => {
    const { out } = await call(ctx, 'sp_expire_holds', [ctx.staff.admin, now], ['p_count']);
    return `${String(out.p_count)} hold(s) expired; ${await queueState(ctx, 'M022')}`;
  } },
  { at: '2026-10-09 09:30', covers: 'Ext: holder collects: reservation fulfilled', run: (c, n) => checkout(c, n, 'S08', ['M022']) },
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
    const staffId = (key: string) => {
      const id = accounts.get(key);
      if (id === undefined) throw new Error(`${PEOPLE_FILE}: account ${key} is missing`);
      return id;
    };
    const copies = new Map<string, number>();
    const ctx: Ctx = {
      pool,
      staff: { admin: staffId('admin'), lib1: staffId('librarian1'), lib2: staffId('librarian2') },
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
      bookOf: new Map(),
      readerTypes: new Map(types.map((t) => [String(t.code), Number(t.id)])),
      materialType: Number(mt.id),
    };

    const steps: Step[] = [
      ...STEPS,
      { at: '2026-08-01 09:00', covers: 'copies registered (sp_register_copy)', run: async (c, now) => {
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
      { at: '2026-08-01 10:00', covers: 'cards issued (one set to expire)', run: async (c, now) => {
        let n = 0;
        for (const r of people.readers) {
          if (r.status !== 'active') continue;
          const months = D1[r.readerType as keyof typeof D1].cardMonths;
          const expires = r.key === 'E04'
            ? vn('2026-09-15 23:59:59.999')
            : vn(`${2026 + Math.floor((7 + months) / 12)}-${String(((7 + months) % 12) + 1).padStart(2, '0')}-01 00:00`);
          const { out } = await call(c, 'sp_issue_card',
            [c.staff.lib1, now, c.reader(r.key), `C2026-${String(++n).padStart(4, '0')}`, expires], ['p_card_id']);
          c.cards.set(r.key, Number(out.p_card_id));
        }
        return `${n} cards`;
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
