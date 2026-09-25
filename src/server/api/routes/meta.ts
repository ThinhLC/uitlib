import type { Hono } from 'hono';
import type { RowDataPacket } from 'mysql2/promise';
import { endpoints, type Me } from '@/lib/api/contract';
import type { ApiDeps, AppEnv } from '@/server/api/context';
import { route } from '@/server/api/define-route';
import { isNil } from '@/lib/utils';

export function registerMeta(app: Hono<AppEnv>, deps: ApiDeps): void {
  route(app, deps, endpoints.health, async () => ({ status: 200, body: { status: 'ok' as const } }));

  route(app, deps, endpoints.me, async (c) => {
    const caller = c.var.caller;
    let reader: Me['reader'] = null;
    if (!isNil(caller.readerId)) {
      const [rows] = await deps.pool.query<RowDataPacket[]>(
        `SELECT r.id, r.full_name, rt.code AS reader_type, r.status
           FROM readers r JOIN reader_types rt ON rt.id = r.reader_type_id
          WHERE r.id = ?`,
        [caller.readerId],
      );
      const r = rows[0];
      if (r) reader = { id: Number(r.id), fullName: r.full_name, readerType: r.reader_type, status: r.status };
    }
    return {
      status: 200,
      body: {
        accountId: caller.accountId,
        status: caller.status,
        roles: caller.roles,
        permissions: [...caller.permissions].sort(),
        reader,
      },
    };
  });
}
