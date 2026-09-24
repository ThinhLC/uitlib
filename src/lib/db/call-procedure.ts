import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

/**
 * A business rejection: `SIGNAL SQLSTATE '45000' 'KEY: detail'` from a procedure or trigger, or a
 * unique-key collision (errno 1062) reported as key `DUPLICATE` with the index name as detail.
 */
export class DbRuleError extends Error {
  constructor(
    public readonly key: string,
    public readonly detail: string,
    public readonly sqlMessage: string,
  ) {
    super(sqlMessage);
    this.name = 'DbRuleError';
  }
}

export interface CallOptions {
  /** Attempts in total for deadlock (1213) / lock wait timeout (1205). Default 3. */
  retries?: number;
  /** Names of OUT parameters, appended after `args` as session variables. */
  outParams?: string[];
}

export interface CallResult<Out = Record<string, unknown>> {
  /** Result sets returned by the procedure, in order. */
  rows: RowDataPacket[][];
  /** OUT parameter values keyed by name. */
  out: Out;
}

const RETRYABLE = new Set([1213, 1205]);

interface MysqlError {
  errno?: number;
  sqlState?: string;
  message?: string;
}

function toRuleError(err: unknown): unknown {
  const e = err as MysqlError;
  if (typeof e?.message !== 'string') return err;
  if (e.sqlState === '45000') {
    const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(e.message);
    if (m) return new DbRuleError(m[1], m[2], e.message);
  }
  if (e.errno === 1062) {
    // "Duplicate entry 'x' for key 'table.index'": the index names the rule that was hit.
    const index = /for key '(?:[^'.]+\.)?([^']+)'/.exec(e.message)?.[1] ?? 'unique key';
    return new DbRuleError('DUPLICATE', index, e.message);
  }
  return err;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call a stored procedure following contracts/db-routines.md "Calling rules":
 * a fresh pooled connection per attempt (never inside a caller's transaction), retry only
 * 1213/1205 with a 50–200 ms random back-off, and map 45000 errors to DbRuleError.
 */
export async function callProcedure<Out = Record<string, unknown>>(
  pool: Pool,
  name: string,
  args: unknown[],
  opts: CallOptions = {},
): Promise<CallResult<Out>> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid procedure name ${name}`);
  const attempts = opts.retries ?? 3;
  const outParams = opts.outParams ?? [];
  const outVars = outParams.map((p) => `@${p}`);
  const placeholders = [...args.map(() => '?'), ...outVars].join(', ');

  for (let attempt = 1; ; attempt++) {
    let conn: PoolConnection | undefined;
    try {
      conn = await pool.getConnection();
      await conn.query('SET SESSION innodb_lock_wait_timeout = 5');
      const [result] = await conn.query(`CALL ${name}(${placeholders})`, args);
      // A CALL returns one array per result set plus a trailing OK packet.
      const rows = Array.isArray(result)
        ? (result as unknown[]).filter((r): r is RowDataPacket[] => Array.isArray(r))
        : [];
      let out = {} as Out;
      if (outVars.length) {
        const [vals] = await conn.query<RowDataPacket[]>(
          `SELECT ${outVars.map((v, i) => `${v} AS \`${outParams[i]}\``).join(', ')}`,
        );
        out = vals[0] as Out;
      }
      return { rows, out };
    } catch (err: unknown) {
      const errno = (err as MysqlError)?.errno;
      if (errno !== undefined && RETRYABLE.has(errno) && attempt < attempts) {
        await sleep(50 + Math.random() * 150);
        continue;
      }
      throw toRuleError(err);
    } finally {
      conn?.release();
    }
  }
}
