'use client';

import { useMemo, useState } from 'react';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { endpoints, type EndpointName, type EndpointSpec, type Me } from '@/lib/api/contract';

/**
 * Dev-only explorer: every contract endpoint the signed-in caller may use, grouped by area, with
 * a generated form (path params, query string, JSON body). Visibility mirrors the endpoint's
 * access rule; for `procedure` endpoints the database decides, so the permission below is only a
 * hint used to hide buttons.
 */

const HIDDEN: EndpointName[] = ['signupHook', 'authCallback', 'authConfirm', 'me'];

/** Permission the stored procedure checks, for `procedure` endpoints (spec 001 db-routines). */
const PROCEDURE_PERMISSION: Partial<Record<EndpointName, string | 'self-or-reservation.manage'>> = {
  registerCopy: 'catalog.write',
  changeCopyStatus: 'catalog.write',
  issueCard: 'card.manage',
  setCardStatus: 'card.manage',
  expireCards: 'card.manage',
  createPolicy: 'policy.manage',
  closePolicy: 'policy.manage',
  recordPayment: 'fine.collect',
  adjustFine: 'fine.adjust',
  reserve: 'self-or-reservation.manage',
  cancelReservation: 'self-or-reservation.manage',
};

const GROUPS: { title: string; match: (name: string, e: EndpointSpec) => boolean }[] = [
  { title: 'My records (reader)', match: (_n, e) => e.access.kind === 'self-or' || /reserv/i.test(_n) },
  { title: 'Catalog', match: (_n, e) => /^\/(catalog|books|authors|publishers|categories|copies\/:)/.test(e.path) },
  { title: 'Desk: circulation', match: (_n, e) => /^\/(loans|loan-items|copies\/by|cards\/by)/.test(e.path) },
  { title: 'Readers, cards, policies', match: (_n, e) => /^\/(readers|cards|policies|reference|jobs\/expire-cards)/.test(e.path) },
  { title: 'Money', match: (_n, e) => /^\/(payments|fines)/.test(e.path) },
  { title: 'Reports and health', match: (_n, e) => /^\/(reports|admin)/.test(e.path) },
  { title: 'Administration', match: (_n, e) => /^\/accounts/.test(e.path) },
  { title: 'Other', match: () => true },
];

function allowed(name: EndpointName, e: EndpointSpec, me: Me): boolean {
  const has = (perms: readonly string[]) => perms.some((p) => me.permissions.includes(p));
  switch (e.access.kind) {
    case 'public':
    case 'token':
    case 'signed-in':
      return true;
    case 'perm':
      return has(e.access.any);
    case 'self-or':
      return me.reader !== null || has(e.access.any);
    case 'procedure': {
      const need = PROCEDURE_PERMISSION[name];
      if (need === 'self-or-reservation.manage') return me.reader !== null || has(['reservation.manage']);
      return need ? has([need]) : true;
    }
    default:
      return false;
  }
}

/** Body templates prefilled with the caller's ids. */
function bodyTemplate(name: EndpointName, me: Me): unknown {
  const readerId = me.reader?.id ?? 1;
  const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const templates: Partial<Record<EndpointName, unknown>> = {
    checkout: { readerId, copyIds: [1] },
    returnItem: { condition: 'good' },
    declareLost: { reason: 'lost by reader' },
    createBook: { title: 'New book', materialType: 'BOOK_PRINT', authorIds: [1], categoryIds: [], identifiers: [] },
    updateBook: { subtitle: 'Updated subtitle' },
    createAuthor: { name: 'New Author' },
    createPublisher: { name: 'New Publisher' },
    createCategory: { name: 'New Category' },
    registerCopy: { barcode: `DEV-${Date.now().toString(36).toUpperCase()}`, condition: 'good' },
    changeCopyStatus: { targetStatus: 'in_repair', condition: 'worn' },
    createReader: { fullName: 'New Reader', readerType: 'STUDENT', email: 'new.reader@example.com' },
    updateReader: { readerType: 'STUDENT' },
    linkAccount: { accountId: me.accountId },
    issueCard: { cardNumber: `DEV-${Date.now().toString(36).toUpperCase()}`, expiresAt: inAYear },
    setCardStatus: { status: 'lost' },
    createPolicy: {
      readerType: 'EXTERNAL', materialType: 'BOOK_PRINT', maxActiveItems: 3, loanDays: 7, maxRenewals: 1,
      dailyLateFeeVnd: 5000, debtBlockThresholdVnd: 0, validFrom: inAYear,
    },
    closePolicy: { validTo: inAYear },
    recordPayment: { readerId, amountVnd: 1000, method: 'cash', requestKey: crypto.randomUUID(), allocations: [{ fineId: 1, amountVnd: 1000 }] },
    adjustFine: { amountVnd: -1000, reason: 'dev adjustment' },
    reserve: { readerId, bookId: 1 },
    cancelReservation: { reason: '' },
    setAccountStatus: { status: 'active' },
  };
  return templates[name] ?? {};
}

const paramNames = (path: string) => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

function paramDefault(param: string, me: Me): string {
  if (param === 'readerId') return String(me.reader?.id ?? '');
  if (param === 'accountId') return String(me.accountId);
  if (param === 'roleCode') return 'librarian';
  return '';
}

type Result = { ok: boolean; status: number; ms: number; data: unknown };

export function ApiExplorer({ me, token }: { me: Me; token: string }) {
  const visible = useMemo(() => {
    const entries = (Object.entries(endpoints) as [EndpointName, EndpointSpec][]).filter(
      ([name, e]) => !HIDDEN.includes(name) && allowed(name, e, me),
    );
    const used = new Set<string>();
    return GROUPS.map((g) => ({
      title: g.title,
      items: entries.filter(([name, e]) => !used.has(name) && g.match(name, e) && used.add(name)),
    })).filter((g) => g.items.length);
  }, [me]);

  const [selected, setSelected] = useState<EndpointName | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  function select(name: EndpointName) {
    const e = endpoints[name] as EndpointSpec;
    setSelected(name);
    setParams(Object.fromEntries(paramNames(e.path).map((p) => [p, paramDefault(p, me)])));
    setQuery(e.query ? 'page=1&pageSize=5' : '');
    setBody(e.body ? JSON.stringify(bodyTemplate(name, me), null, 2) : '');
    setResult(null);
  }

  async function send() {
    if (!selected) return;
    const e = endpoints[selected] as EndpointSpec;
    let parsedBody: unknown;
    try {
      parsedBody = e.body ? JSON.parse(body || '{}') : undefined;
    } catch {
      setResult({ ok: false, status: 0, ms: 0, data: 'Body is not valid JSON' });
      return;
    }
    const input = {
      params: Object.keys(params).length ? params : undefined,
      query: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
      body: parsedBody,
    };
    setBusy(true);
    const t0 = performance.now();
    try {
      const data = await apiFetch(e, input as never, { token: e.access.kind === 'public' ? undefined : token });
      setResult({ ok: true, status: 0, ms: Math.round(performance.now() - t0), data: data ?? '(no content)' });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      setResult(err instanceof ApiClientError ? { ok: false, status: err.status, ms, data: err.body } : { ok: false, status: 0, ms, data: String(err) });
    } finally {
      setBusy(false);
    }
  }

  const button = 'rounded border px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10';
  const current = selected ? (endpoints[selected] as EndpointSpec) : null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">API explorer</h2>
      <p className="text-xs opacity-70">
        Buttons follow your roles ({me.roles.join(', ') || 'none'}); the server and the database still decide.
      </p>
      {visible.map((g) => (
        <div key={g.title}>
          <h3 className="mb-1 text-sm font-medium">{g.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map(([name, e]) => (
              <button
                key={name}
                className={`${button} ${selected === name ? 'bg-black/10 dark:bg-white/15' : ''}`}
                title={`${e.method} /api/v1${e.path}`}
                onClick={() => select(name)}
              >
                <span className="font-mono opacity-60">{e.method}</span> {name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {current && selected && (
        <div className="space-y-2 rounded border p-3">
          <div className="font-mono text-sm">
            {current.method} /api/v1{current.path}
            {current.procedure && <span className="opacity-60"> → {current.procedure}</span>}
          </div>
          <div className="text-xs opacity-70">
            access: {JSON.stringify(current.access)} · errors: {current.errors.join(', ') || '—'}
          </div>
          {Object.keys(params).map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <span className="w-28 font-mono">:{p}</span>
              <input
                className="flex-1 rounded border px-2 py-1 font-mono text-sm"
                value={params[p]}
                onChange={(ev) => setParams({ ...params, [p]: ev.target.value })}
              />
            </label>
          ))}
          {current.query && (
            <label className="flex items-center gap-2 text-sm">
              <span className="w-28 font-mono">query</span>
              <input
                className="flex-1 rounded border px-2 py-1 font-mono text-sm"
                placeholder="q=data&page=1"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
              />
            </label>
          )}
          {current.body && (
            <textarea
              className="h-40 w-full rounded border p-2 font-mono text-xs"
              value={body}
              onChange={(ev) => setBody(ev.target.value)}
            />
          )}
          <button className={button} onClick={send} disabled={busy}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}

      {result && (
        <div>
          <h3 className="text-sm font-semibold">
            {result.ok ? 'OK' : 'Error'} {result.status ? result.status : ''} · {result.ms} ms
          </h3>
          <pre className="mt-1 max-h-96 overflow-auto rounded border p-3 text-xs">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
