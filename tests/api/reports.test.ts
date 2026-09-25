import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPools } from '../helpers/db';
import { adjust, lateFine, otherReader, pay, truncateAll } from '../helpers/fixtures';
import { vn } from '../helpers/time';
import { asAccount, asReader, createTestApp, req } from './helpers/app';

afterAll(closeTestPools);
beforeEach(truncateAll);

const { app, clock } = createTestApp();

/**
 * Spec 001 US4-14 and SC-006: reader A's 30,000 fine is assessed on 2026-09-25 and paid on
 * 2026-10-05; reader B's fine is assessed on 2026-10-03, adjusted and partly paid in October.
 */
async function debtWorld() {
  const a = await lateFine({ days: 15, returnedAt: vn('2026-09-25 10:00') });
  const b = await lateFine({ days: 5, returnedAt: vn('2026-10-03 10:00'), world: await otherReader(a.world) });
  const staff = a.world.staff;
  await pay(staff, vn('2026-10-05 10:00'), a.world.readerId, 30000, [{ fineId: a.fineId, amount: 30000 }]);
  await adjust(staff, vn('2026-10-06 10:00'), b.fineId, -2000, 'goodwill');
  await pay(staff, vn('2026-10-10 10:00'), b.world.readerId, 4000, [{ fineId: b.fineId, amount: 4000 }]);
  return { a, b, readerA: a.world.readerId, readerB: b.world.readerId };
}

describe('US7 reports and health (T065)', () => {
  it('US7-1: the October roll-forward keeps closing = opening + assessed + adjusted − collected', async () => {
    const d = await debtWorld();
    const { token } = await asAccount(['librarian']);
    const res = await req(app, 'GET', '/reports/debt/rollforward', { token, query: { month: '2026-10' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: '2026-10', from: '2026-09-30T17:00:00.000Z', to: '2026-10-31T17:00:00.000Z' });
    expect(res.body.rows).toHaveLength(2);
    for (const r of res.body.rows) {
      expect(r.closingOutstandingVnd).toBe(r.openingOutstandingVnd + r.assessedInPeriodVnd + r.adjustedInPeriodVnd - r.collectedInPeriodVnd);
    }
    // US4-14 for reader A: 30,000 opening, collected in October, nothing left.
    expect(res.body.rows.find((r: any) => r.readerId === d.readerA)).toEqual({
      readerId: d.readerA, openingOutstandingVnd: 30000, assessedInPeriodVnd: 0, adjustedInPeriodVnd: 0,
      collectedInPeriodVnd: 30000, closingOutstandingVnd: 0 });

    const sep = await req(app, 'GET', '/reports/debt/rollforward', { token, query: { month: '2026-09', readerId: d.readerA } });
    expect(sep.body.rows).toEqual([{ readerId: d.readerA, openingOutstandingVnd: 0, assessedInPeriodVnd: 30000,
      adjustedInPeriodVnd: 0, collectedInPeriodVnd: 0, closingOutstandingVnd: 30000 }]);

    const bad = await req(app, 'GET', '/reports/debt/rollforward', { token, query: { month: '2026-13' } });
    expect(bad.status).toBe(400);
    expect((await req(app, 'GET', '/reports/debt/rollforward', { token })).status).toBe(400);
  });

  it('US7-2: the cumulative report keeps net assessed = collected + outstanding', async () => {
    const d = await debtWorld();
    const { token } = await asAccount(['librarian']);
    const res = await req(app, 'GET', '/reports/debt/cumulative', { token, query: { asOf: '2026-10-31T23:59:59.999+07:00' } });
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe('2026-10-31T16:59:59.999Z');
    expect(res.body.rows).toHaveLength(2);
    for (const r of res.body.rows) expect(r.netAssessedVnd).toBe(r.collectedVnd + r.outstandingVnd);
    expect(res.body.rows.find((r: any) => r.readerId === d.readerA)).toEqual({
      readerId: d.readerA, netAssessedVnd: 30000, collectedVnd: 30000, outstandingVnd: 0 });
    const b = res.body.rows.find((r: any) => r.readerId === d.readerB);
    expect(b).toEqual({ readerId: d.readerB, netAssessedVnd: d.b.amount - 2000, collectedVnd: 4000,
      outstandingVnd: d.b.amount - 6000 });

    // Default asOf is the server's business time; before October only reader A has a record.
    clock.set(vn('2026-09-30 12:00'));
    const early = await req(app, 'GET', '/reports/debt/cumulative', { token });
    expect(early.body.asOf).toBe('2026-09-30T05:00:00.000Z');
    expect(early.body.rows).toEqual([{ readerId: d.readerA, netAssessedVnd: 30000, collectedVnd: 0, outstandingVnd: 30000 }]);
  });

  it('US7-3: circulation reports; copy status counts add up to the total', async () => {
    await debtWorld();
    const { token } = await asAccount(['librarian']);
    const status = await req(app, 'GET', '/reports/copy-status', { token });
    expect(status.status).toBe(200);
    expect(status.body.total).toBeGreaterThan(0);
    for (const r of status.body.items) {
      expect(r.available + r.onLoan + r.onHold + r.inRepair + r.lost + r.retired).toBe(r.total);
    }

    const byMonth = await req(app, 'GET', '/reports/loans-by-month', { token, query: { fromMonth: '2026-09', toMonth: '2026-09' } });
    expect(byMonth.status).toBe(200);
    expect(byMonth.body.items.length).toBeGreaterThan(0);
    for (const r of byMonth.body.items) {
      expect(r.monthLocal).toBe('2026-09');
      expect(r.readerType).toBe('STUDENT');
      expect(r.items).toBeGreaterThanOrEqual(r.loans);
    }

    const popular = await req(app, 'GET', '/reports/popular-books', { token, query: { limit: 1 } });
    expect(popular.status).toBe(200);
    expect(popular.body.items).toHaveLength(1);
    expect(popular.body.items[0].loanItems).toBe(2);
    expect((await req(app, 'GET', '/reports/popular-books', { token, query: { limit: 101 } })).status).toBe(400);

    const overdue = await req(app, 'GET', '/reports/overdue', { token, query: { pageSize: 5 } });
    expect(overdue.status).toBe(200);
    expect(overdue.body).toMatchObject({ page: 1, pageSize: 5 });
  });

  it('report.read is required; /admin/health lists the invariant views with no violations', async () => {
    const d = await debtWorld();
    const reader = await asReader(d.readerA);
    for (const path of ['/reports/debt/cumulative', '/reports/copy-status', '/admin/health']) {
      const res = await req(app, 'GET', path, { token: reader.token });
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toMatchObject({ key: 'FORBIDDEN', detail: 'report.read' });
    }

    const { token } = await asAccount(['admin']);
    const health = await req(app, 'GET', '/admin/health', { token });
    expect(health.status).toBe(200);
    expect(health.body.violations).toEqual([]);
    expect(health.body.views).toHaveLength(9);
    expect(health.body.views.every((v: string) => v.startsWith('v_inv_'))).toBe(true);
  });
});
