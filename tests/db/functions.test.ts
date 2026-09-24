import { afterAll, describe, expect, it } from 'vitest';
import { appConn, closeTestPools } from '../helpers/db';
import { account, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';

afterAll(closeTestPools);

async function scalar(sql: string, params: unknown[] = []): Promise<any> {
  const conn = await appConn();
  try {
    const [[row]] = (await conn.query(`SELECT ${sql} v`, params)) as any;
    return row.v;
  } finally {
    await conn.end();
  }
}

describe('Stored functions (T032, contracts/db-routines.md)', () => {
  it('US2-10: fn_due_at gives end of the local day, loan_days later', async () => {
    expect(await scalar('fn_due_at(?, 14)', [vn('2026-09-30 23:59:59.900')])).toBe(vn('2026-10-14 23:59:59.999'));
    expect(await scalar('fn_due_at(?, 7)', [vn('2026-10-01 00:00:00.000')])).toBe(vn('2026-10-08 23:59:59.999'));
  });

  it('US4-1/US4-2: fn_days_late counts local calendar days, minimum 0', async () => {
    const due = vn('2026-10-10 23:59:59.999');
    expect(Number(await scalar('fn_days_late(?, ?)', [due, vn('2026-10-13 09:00')]))).toBe(3);
    expect(Number(await scalar('fn_days_late(?, ?)', [due, vn('2026-10-10 18:00')]))).toBe(0);
    expect(Number(await scalar('fn_days_late(?, ?)', [due, vn('2026-10-09 18:00')]))).toBe(0);
  });

  it('US4-3 D2: fn_late_fee multiplies and caps', async () => {
    expect(Number(await scalar('fn_late_fee(10, 2000, 150000)'))).toBe(20000);
    expect(Number(await scalar('fn_late_fee(100, 2000, 150000)'))).toBe(150000);
    expect(Number(await scalar('fn_late_fee(3, 2000, NULL)'))).toBe(6000);
  });

  it('R-20: fn_has_permission is false for inactive accounts and missing permissions', async () => {
    await truncateAll();
    const librarian = await account(['librarian']);
    const inactive = await account(['admin'], { status: 'inactive' });
    expect(Number(await scalar(`fn_has_permission(?, 'loan.checkout')`, [librarian]))).toBe(1);
    expect(Number(await scalar(`fn_has_permission(?, 'policy.manage')`, [librarian]))).toBe(0);
    expect(Number(await scalar(`fn_has_permission(?, 'loan.checkout')`, [inactive]))).toBe(0);
    expect(Number(await scalar(`fn_has_permission(?, 'loan.checkout')`, [999999]))).toBe(0);
  });
});
