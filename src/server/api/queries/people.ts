import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  Card,
  Items,
  Page,
  PageQuery,
  PolicyVersion,
  Reader,
  ReaderInput,
  ReaderStatus,
  ReaderUpdateInput,
  ReferenceType,
} from '@/lib/api/contract';
import { fromDbTime, isoToDbTime } from '@/lib/time/db-time';
import { ApiError } from '@/server/api/errors/api-error';
import { isNil, isUndefined, mapNullable, omitUndefined, toNumberOrNull } from '@/lib/utils';
import { one, paged, rows, transaction } from './sql';

type Db = Pool | PoolConnection;

/** Escape `%`, `_` and `\` for a `LIKE ?` prefix search. */
export const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** A unique-key collision (errno 1062) on a direct write, as `DUPLICATE <index name>`. */
export function duplicateOrRethrow(err: unknown): never {
  const e = err as { errno?: number; message?: string };
  if (e?.errno === 1062) {
    const index = /for key '(?:[^'.]+\.)?([^']+)'/.exec(String(e.message))?.[1] ?? 'unique key';
    throw new ApiError('DUPLICATE', index);
  }
  throw err;
}

/** Id of a reader type or material type code, or null. */
export async function typeIdByCode(db: Db, kind: 'readerType' | 'materialType', code: string): Promise<number | null> {
  const table = kind === 'readerType' ? 'reader_types' : 'material_types';
  const row = await one(db, `SELECT id FROM ${table} WHERE code = ?`, [code]);
  return row ? Number(row.id) : null;
}

/** Id of a reader type code, else NOT_FOUND `readerType`. */
async function readerTypeId(db: Db, code: string): Promise<number> {
  const id = await typeIdByCode(db, 'readerType', code);
  if (isNil(id)) throw new ApiError('NOT_FOUND', 'readerType');
  return id;
}

/** True when the reader exists. */
export async function readerExists(db: Db, readerId: number): Promise<boolean> {
  return !isNil(await one(db, 'SELECT id FROM readers WHERE id = ?', [readerId]));
}

const CARD_COLUMNS = 'c.id, c.reader_id, c.card_number, c.issued_at, c.expires_at, c.status';

function toCard(r: RowDataPacket, dbNow: string): Card {
  return {
    id: Number(r.id),
    readerId: Number(r.reader_id),
    cardNumber: r.card_number,
    issuedAt: fromDbTime(r.issued_at),
    expiresAt: fromDbTime(r.expires_at),
    status: r.status,
    validNow: r.status === 'active' && String(r.expires_at) > dbNow,
  };
}

const READER_SELECT = `
  SELECT r.id, r.full_name, r.email, r.phone, rt.code AS reader_type, r.status, r.user_id, r.created_at,
         c.id AS card_id, c.card_number, c.issued_at, c.expires_at, c.status AS card_status
    FROM readers r
    JOIN reader_types rt ON rt.id = r.reader_type_id
    LEFT JOIN library_cards c ON c.active_reader_id = r.id`;

function toReader(r: RowDataPacket, dbNow: string): Reader {
  return {
    id: Number(r.id),
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    readerType: r.reader_type,
    status: r.status,
    accountId: toNumberOrNull(r.user_id),
    createdAt: fromDbTime(r.created_at),
    activeCard: mapNullable(r.card_id, (id) =>
      toCard(
        {
          id,
          reader_id: r.id,
          card_number: r.card_number,
          issued_at: r.issued_at,
          expires_at: r.expires_at,
          status: r.card_status,
        } as RowDataPacket,
        dbNow,
      ),
    ),
  };
}

/** Readers matching `q` (prefix of name, email or phone), `status` and `readerType`. */
export function listReaders(
  pool: Pool,
  dbNow: string,
  f: PageQuery & { q?: string; status?: ReaderStatus; readerType?: string },
): Promise<Page<Reader>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    const p = likePrefix(f.q);
    where.push('(r.full_name LIKE ? OR r.email LIKE ? OR r.phone LIKE ?)');
    params.push(p, p, p);
  }
  if (f.status) {
    where.push('r.status = ?');
    params.push(f.status);
  }
  if (f.readerType) {
    where.push('rt.code = ?');
    params.push(f.readerType);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paged(pool, {
    select: `${READER_SELECT} ${clause} ORDER BY r.full_name, r.id`,
    count: `SELECT COUNT(*) FROM readers r JOIN reader_types rt ON rt.id = r.reader_type_id ${clause}`,
    params,
    page: f,
    map: (r) => toReader(r, dbNow),
  });
}

/** One reader, or null. */
export async function getReader(db: Db, readerId: number, dbNow: string): Promise<Reader | null> {
  const row = await one(db, `${READER_SELECT} WHERE r.id = ?`, [readerId]);
  return row ? toReader(row, dbNow) : null;
}

async function mustGetReader(db: Db, readerId: number, dbNow: string): Promise<Reader> {
  const r = await getReader(db, readerId, dbNow);
  if (!r) throw new ApiError('NOT_FOUND', 'reader');
  return r;
}

/** Insert a reader (direct write, `card.manage`). */
export async function createReader(pool: Pool, input: ReaderInput, dbNow: string): Promise<Reader> {
  const typeId = await readerTypeId(pool, input.readerType);
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO readers (user_id, reader_type_id, full_name, email, phone, status, created_at)
     VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
    [typeId, input.fullName, input.email ?? null, input.phone ?? null, input.status ?? 'active', dbNow],
  );
  return mustGetReader(pool, Number(res.insertId), dbNow);
}

/** Update the given reader fields (direct write, `card.manage`). */
export async function updateReader(
  pool: Pool,
  readerId: number,
  input: ReaderUpdateInput,
  dbNow: string,
): Promise<Reader> {
  // Only the fields sent are changed; `null` clears email/phone.
  const changes = Object.entries(
    omitUndefined({
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      status: input.status,
      reader_type_id: isUndefined(input.readerType) ? undefined : await readerTypeId(pool, input.readerType),
    }),
  );
  if (changes.length) {
    await pool.query(`UPDATE readers SET ${changes.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`, [
      ...changes.map(([, v]) => v),
      readerId,
    ]);
  }
  return mustGetReader(pool, readerId, dbNow);
}

/**
 * Link an account to a reader (data-model.md "Account link"): the account must exist and be
 * active, and the reader must be unlinked. A second reader for the same account is
 * `DUPLICATE readers_user_uq`.
 */
export async function linkAccount(pool: Pool, readerId: number, accountId: number, dbNow: string): Promise<Reader> {
  try {
    await transaction(pool, async (conn) => {
      const reader = await one(conn, 'SELECT user_id FROM readers WHERE id = ? FOR UPDATE', [readerId]);
      if (!reader) throw new ApiError('NOT_FOUND', 'reader');
      const acct = await one(conn, 'SELECT status FROM app_users WHERE id = ? FOR SHARE', [accountId]);
      if (!acct) throw new ApiError('NOT_FOUND', 'account');
      if (acct.status !== 'active') {
        throw new ApiError('VALIDATION', 'account', [{ path: 'accountId', message: 'account is inactive' }]);
      }
      if (!isNil(reader.user_id)) {
        throw new ApiError('VALIDATION', 'reader', [{ path: 'readerId', message: 'reader is already linked' }]);
      }
      await conn.query('UPDATE readers SET user_id = ? WHERE id = ?', [accountId, readerId]);
    });
  } catch (err) {
    duplicateOrRethrow(err);
  }
  return mustGetReader(pool, readerId, dbNow);
}

/** Remove a reader's account link (idempotent). */
export async function unlinkAccount(pool: Pool, readerId: number, dbNow: string): Promise<Reader> {
  await pool.query('UPDATE readers SET user_id = NULL WHERE id = ?', [readerId]);
  return mustGetReader(pool, readerId, dbNow);
}

/** Every card of a reader, newest first; NOT_FOUND when the reader does not exist. */
export async function listCards(pool: Pool, readerId: number, dbNow: string): Promise<Items<Card>> {
  if (!(await readerExists(pool, readerId))) throw new ApiError('NOT_FOUND', 'reader');
  const rs = await rows(
    pool,
    `SELECT ${CARD_COLUMNS} FROM library_cards c WHERE c.reader_id = ? ORDER BY c.issued_at DESC, c.id DESC`,
    [readerId],
  );
  return { items: rs.map((r) => toCard(r, dbNow)) };
}

/** One card; NOT_FOUND `card`. */
export async function getCard(pool: Pool, cardId: number, dbNow: string): Promise<Card> {
  const row = await one(pool, `SELECT ${CARD_COLUMNS} FROM library_cards c WHERE c.id = ?`, [cardId]);
  if (!row) throw new ApiError('NOT_FOUND', 'card');
  return toCard(row, dbNow);
}

const POLICY_SELECT = `
  SELECT p.id, rt.code AS reader_type, mt.code AS material_type, p.max_active_items, p.loan_days,
         p.max_renewals, p.daily_late_fee_vnd, p.debt_block_threshold_vnd, p.valid_from, p.valid_to
    FROM loan_policies p
    JOIN reader_types rt ON rt.id = p.reader_type_id
    JOIN material_types mt ON mt.id = p.material_type_id`;

function toPolicy(r: RowDataPacket): PolicyVersion {
  return {
    id: Number(r.id),
    readerType: r.reader_type,
    materialType: r.material_type,
    maxActiveItems: Number(r.max_active_items),
    loanDays: Number(r.loan_days),
    maxRenewals: Number(r.max_renewals),
    dailyLateFeeVnd: Number(r.daily_late_fee_vnd),
    debtBlockThresholdVnd: Number(r.debt_block_threshold_vnd),
    validFrom: fromDbTime(r.valid_from),
    validTo: fromDbTime(r.valid_to),
  };
}

/** Policy versions filtered by type codes and the instant they are in effect at. */
export function listPolicies(
  pool: Pool,
  f: PageQuery & { readerType?: string; materialType?: string; activeAt?: string },
): Promise<Page<PolicyVersion>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.readerType) {
    where.push('rt.code = ?');
    params.push(f.readerType);
  }
  if (f.materialType) {
    where.push('mt.code = ?');
    params.push(f.materialType);
  }
  if (f.activeAt) {
    const t = isoToDbTime(f.activeAt);
    where.push('p.valid_from <= ? AND (p.valid_to IS NULL OR p.valid_to > ?)');
    params.push(t, t);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paged(pool, {
    select: `${POLICY_SELECT} ${clause} ORDER BY p.valid_from DESC, p.id DESC`,
    count: `SELECT COUNT(*) FROM loan_policies p
              JOIN reader_types rt ON rt.id = p.reader_type_id
              JOIN material_types mt ON mt.id = p.material_type_id ${clause}`,
    params,
    page: f,
    map: toPolicy,
  });
}

/** One policy version; NOT_FOUND `policy`. */
export async function getPolicy(pool: Pool, policyId: number): Promise<PolicyVersion> {
  const row = await one(pool, `${POLICY_SELECT} WHERE p.id = ?`, [policyId]);
  if (!row) throw new ApiError('NOT_FOUND', 'policy');
  return toPolicy(row);
}

async function referenceList(pool: Pool, table: 'reader_types' | 'material_types'): Promise<Items<ReferenceType>> {
  const rs = await rows(pool, `SELECT id, code, name FROM ${table} ORDER BY code`);
  return { items: rs.map((r) => ({ id: Number(r.id), code: r.code, name: r.name })) };
}

/** Every reader type. */
export const readerTypes = (pool: Pool) => referenceList(pool, 'reader_types');

/** Every material type. */
export const materialTypes = (pool: Pool) => referenceList(pool, 'material_types');
