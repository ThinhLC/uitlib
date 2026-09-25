import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Account, AccountStatus, Page, PageQuery } from '@/lib/api/contract';
import { fromDbTime } from '@/lib/time/db-time';
import type { Caller } from '@/server/api/context';
import { ApiError, notFound } from '@/server/api/errors/api-error';
import { toNumberOrNull } from '@/lib/utils';
import { one, paged, transaction } from './sql';

const SELECT = `
  SELECT u.id, u.status, u.created_at, u.supabase_user_id,
         (SELECT GROUP_CONCAT(ro.code ORDER BY ro.code SEPARATOR ',')
            FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
         (SELECT MIN(rd.id) FROM readers rd WHERE rd.user_id = u.id) AS reader_id
    FROM app_users u`;

function toAccount(r: RowDataPacket): Account {
  return {
    id: Number(r.id),
    status: r.status as AccountStatus,
    createdAt: fromDbTime(String(r.created_at)),
    roles: r.roles ? String(r.roles).split(',') : [],
    readerId: toNumberOrNull(r.reader_id),
    subject: String(r.supabase_user_id),
  };
}

/** Accounts, oldest first, optionally by status and role code. */
export function listAccounts(
  pool: Pool,
  q: PageQuery & { status?: AccountStatus; role?: string },
): Promise<Page<Account>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status) {
    where.push('u.status = ?');
    params.push(q.status);
  }
  if (q.role) {
    where.push(`EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
                         WHERE ur.user_id = u.id AND ro.code = ?)`);
    params.push(q.role);
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  return paged(pool, {
    select: `${SELECT}${w} ORDER BY u.id`,
    count: `SELECT COUNT(*) n FROM app_users u${w}`,
    params,
    page: q,
    map: toAccount,
  });
}

/** One account, or NOT_FOUND `account`. */
export async function getAccount(pool: Pool | PoolConnection, id: number): Promise<Account> {
  const row = await one(pool, `${SELECT} WHERE u.id = ?`, [id]);
  if (!row) throw notFound('account');
  return toAccount(row);
}

async function lockAccount(conn: PoolConnection, id: number): Promise<void> {
  if (!(await one(conn, `SELECT id FROM app_users WHERE id = ? FOR UPDATE`, [id]))) throw notFound('account');
}

async function roleId(conn: PoolConnection, code: string): Promise<number> {
  const row = await one(conn, `SELECT id FROM roles WHERE code = ?`, [code]);
  if (!row) throw notFound('role');
  return Number(row.id);
}

/** An admin may not take away their own admin role or deactivate themself (no lockout). */
function selfLockout(path: string, message: string): ApiError {
  return new ApiError('VALIDATION', 'self_lockout', [{ path, message }]);
}

/** Give a role; an existing pair is left as it is (idempotent). */
export async function assignRole(pool: Pool, accountId: number, roleCode: string): Promise<void> {
  await transaction(pool, async (conn) => {
    await lockAccount(conn, accountId);
    const role = await roleId(conn, roleCode);
    await conn.query(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [accountId, role]);
  });
}

/** Take a role away; a pair that does not exist is not an error. */
export async function removeRole(pool: Pool, caller: Caller, accountId: number, roleCode: string): Promise<void> {
  if (accountId === caller.accountId && roleCode === 'admin') {
    throw selfLockout('roleCode', 'you cannot remove your own admin role');
  }
  await transaction(pool, async (conn) => {
    await lockAccount(conn, accountId);
    const role = await roleId(conn, roleCode);
    await conn.query(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [accountId, role]);
  });
}

/** Activate or deactivate an account (FR-011a); returns the account afterwards. */
export async function setStatus(pool: Pool, caller: Caller, accountId: number, status: AccountStatus): Promise<Account> {
  if (accountId === caller.accountId && status === 'inactive') {
    throw selfLockout('status', 'you cannot deactivate your own account');
  }
  return transaction(pool, async (conn) => {
    await lockAccount(conn, accountId);
    await conn.query(`UPDATE app_users SET status = ? WHERE id = ?`, [status, accountId]);
    return getAccount(conn, accountId);
  });
}
