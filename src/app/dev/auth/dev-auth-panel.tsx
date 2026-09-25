'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { endpoints, type Me } from '@/lib/api/contract';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ApiExplorer } from './api-explorer';
import { isNil } from '@/lib/utils';

/** Seeded test accounts (data/seed/people.json); passwords live in Supabase only. */
const TEST_ACCOUNTS = ['admin', 'librarian', 'student', 'lecturer', 'external'].map((r) => `account+${r}@gmail.com`);

type Result = { ok: true; data: unknown } | { ok: false; status?: number; data: unknown };

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function DevAuthPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  // Load the caller (roles, permissions, reader) whenever the session changes; the explorer
  // shows only the endpoints this caller may use.
  useEffect(() => {
    if (isNil(session)) return;
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(setMe)
      .catch(() => setMe(null));
  }, [session]);
  const caller = session ? me : null;

  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}/api/v1/auth/callback?next=/dev/auth`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) setResult({ ok: false, data: error.message });
  }

  async function signInWithPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    setResult(error ? { ok: false, data: error.message } : null);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setResult(null);
  }

  async function callMe() {
    if (isNil(session)) return;
    try {
      const data = await apiFetch(endpoints.me, {}, { token: session.access_token });
      setMe(data);
      setResult({ ok: true, data });
    } catch (err) {
      setResult(
        err instanceof ApiClientError
          ? { ok: false, status: err.status, data: err.body }
          : { ok: false, data: String(err) },
      );
    }
  }

  async function copyToken() {
    if (isNil(session)) return;
    await navigator.clipboard.writeText(session.access_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return <p className="mt-6">Loading session…</p>;

  const button = 'rounded border px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10';

  return (
    <div className="mt-6 space-y-6">
      {!session ? (
        <div className="space-y-4">
          <button className={button} onClick={signInWithGoogle}>
            Sign in with Google
          </button>
          <form onSubmit={signInWithPassword} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="opacity-70">or email/password:</span>
            <input name="email" list="test-accounts" placeholder="account+student@gmail.com" required className="rounded border px-2 py-1" />
            <datalist id="test-accounts">
              {TEST_ACCOUNTS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <input name="password" type="password" placeholder="password" required className="rounded border px-2 py-1" />
            <button className={button} type="submit">
              Sign in
            </button>
          </form>
        </div>
      ) : (
        <>
          <section className="space-y-1 text-sm">
            <div>
              <b>User:</b> {session.user.email} <code className="opacity-70">({session.user.id})</code>
            </div>
            <div>
              <b>Providers:</b> {((session.user.app_metadata.providers as string[] | undefined) ?? []).join(', ')}
            </div>
            <div>
              <b>Token expires:</b> {session.expires_at ? new Date(session.expires_at * 1000).toLocaleString() : '—'}
            </div>
            <div className="break-all">
              <b>Access token:</b> <code className="opacity-70">{session.access_token.slice(0, 32)}…</code>
            </div>
          </section>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={callMe}>
              Call GET /api/v1/me
            </button>
            <button className={button} onClick={copyToken}>
              {copied ? 'Copied' : 'Copy access token'}
            </button>
            <button className={button} onClick={signOut}>
              Sign out
            </button>
          </div>
        </>
      )}
      {session && caller && <ApiExplorer me={caller} token={session.access_token} />}
      {result && (
        <section>
          <h2 className="text-sm font-semibold">
            {result.ok ? 'Response' : `Error${'status' in result && result.status ? ` ${result.status}` : ''}`}
          </h2>
          <pre className="mt-2 overflow-auto rounded border p-3 text-xs">{pretty(result.data)}</pre>
        </section>
      )}
    </div>
  );
}
