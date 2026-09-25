import { isString, isUndefined } from '@/lib/utils'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withRetry } from '@/lib/db/with-retry';
import type { Caller } from '@/server/api/context';
import { toNumberOrNull } from '@/lib/utils';

const split = (s: unknown): string[] => (isString(s) && s !== '' ? s.split(',') : []);

/**
 * The caller for a Supabase subject, or null when no account exists (data-model.md "Request
 * path"). One read-only query: it never writes or locks (analysis U1).
 */
export async function resolveCaller(pool: Pool, subject: string): Promise<Caller | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.status, r.id AS reader_id,
            (SELECT GROUP_CONCAT(ro.code ORDER BY ro.code)
               FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
              WHERE ur.user_id = u.id) AS roles,
            (SELECT GROUP_CONCAT(DISTINCT p.code ORDER BY p.code)
               FROM user_roles ur
               JOIN role_permissions rp ON rp.role_id = ur.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE ur.user_id = u.id) AS permissions
       FROM app_users u
       LEFT JOIN readers r ON r.user_id = u.id
      WHERE u.supabase_user_id = ?`,
    [subject],
  );
  const row = rows[0];
  if (isUndefined(row)) return null;
  return {
    accountId: Number(row.id),
    subject,
    status: row.status,
    roles: split(row.roles),
    permissions: new Set(split(row.permissions)),
    readerId: toNumberOrNull(row.reader_id),
  };
}

/** What the identity provider tells us about a new user (Google name and verified email). */
export interface ProviderProfile {
  fullName?: string | null;
  email?: string | null;
}

/** Outcome of the reader-profile step (spec 002 FR-008e). */
export type ReaderProfileOutcome = 'created' | 'existing';

const DEFAULT_READER_TYPE = 'EXTERNAL';

/** A display name for a new reader: the provider's name, else the email's local part. */
function readerName(profile: ProviderProfile): string {
  const name = profile.fullName?.trim() || profile.email?.split('@')[0]?.trim() || 'Library reader';
  return name.slice(0, 200);
}

/**
 * Make sure the account has its reader profile (FR-008e). The link is by id only:
 * `readers.user_id = app_users.id`, where the account was found by the Supabase `sub`. No email
 * matching: a desk-created profile is linked by a librarian after checking identity.
 * `INSERT IGNORE` relies on `readers_user_uq`, so concurrent callers still leave one profile.
 * The name and email only prefill the profile; a card from the desk is still needed to borrow.
 */
async function ensureReaderProfile(
  conn: PoolConnection,
  accountId: number,
  profile: ProviderProfile,
  dbNow: string,
): Promise<ReaderProfileOutcome> {
  const [ins] = await conn.query<ResultSetHeader>(
    `INSERT IGNORE INTO readers (user_id, reader_type_id, full_name, email, phone, status, created_at)
     SELECT ?, id, ?, ?, NULL, 'active', ? FROM reader_types WHERE code = ?`,
    [accountId, readerName(profile), profile.email?.trim().slice(0, 320) || null, dbNow, DEFAULT_READER_TYPE],
  );
  return ins.affectedRows === 1 ? 'created' : 'existing';
}

export interface EnsureOptions {
  /** Attempts on deadlock / lock wait timeout; the sign-up hook passes 1 (analysis U2). */
  attempts?: number;
  /** Session lock wait for this transaction, in seconds (the hook uses 2). */
  lockWaitSeconds?: number;
}

/**
 * Resolve the library account of a Supabase subject (`app_users.supabase_user_id = sub`),
 * creating it with the `reader` role if it does not exist, and make sure it has its reader
 * profile (FR-008, FR-008e), in one transaction. Idempotent and safe under concurrency: the
 * unique keys on `supabase_user_id` and `readers.user_id` serialize creators. An existing
 * account's status and roles are never changed.
 */
export async function ensureAccount(
  pool: Pool,
  subject: string,
  dbNow: string,
  profile: ProviderProfile = {},
  opts: EnsureOptions = {},
): Promise<{ accountId: number; created: boolean; reader: ReaderProfileOutcome }> {
  return withRetry(async () => {
    const conn = await pool.getConnection();
    try {
      if (opts.lockWaitSeconds) {
        await conn.query('SET SESSION innodb_lock_wait_timeout = ?', [opts.lockWaitSeconds]);
      }
      await conn.beginTransaction();
      try {
        // INSERT IGNORE waits on the unique key while another creator's transaction is open, then
        // skips the duplicate. (mysql2 sets FOUND_ROWS, so ON DUPLICATE KEY UPDATE could not tell
        // "created" from "existed" by affectedRows.)
        const [ins] = await conn.query<ResultSetHeader>(
          `INSERT IGNORE INTO app_users (supabase_user_id, status, created_at) VALUES (?, 'active', ?)`,
          [subject, dbNow],
        );
        const created = ins.affectedRows === 1;
        let accountId = Number(ins.insertId);
        if (!created) {
          const [rows] = await conn.query<RowDataPacket[]>(
            'SELECT id FROM app_users WHERE supabase_user_id = ?',
            [subject],
          );
          accountId = Number(rows[0].id);
        }
        if (created) {
          await conn.query(
            `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'reader'`,
            [accountId],
          );
        }
        const reader = await ensureReaderProfile(conn, accountId, profile, dbNow);
        await conn.commit();
        return { accountId, created, reader };
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      if (opts.lockWaitSeconds) {
        await conn.query('SET SESSION innodb_lock_wait_timeout = 5').catch(() => {});
      }
      conn.release();
    }
  }, opts.attempts ?? 3);
}
