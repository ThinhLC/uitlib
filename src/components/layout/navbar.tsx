'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Library, LogOut, LogIn } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch } from '@/lib/api/client';
import { endpoints, type Me } from '@/lib/api/contract';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Session } from '@supabase/supabase-js';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị',
  librarian: 'Thủ thư',
  reader: 'Bạn đọc',
};

export function Navbar() {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(setMe)
      .catch(() => setMe(null));
  }, [session]);

  const roles = me?.roles ?? [];
  const isLibrarian = roles.includes('librarian') || roles.includes('admin');
  const isAdmin = roles.includes('admin');

  const links = [
    { href: '/catalog', label: 'Tra cứu sách' },
    ...(session ? [{ href: '/reader', label: 'Sách đang mượn' }] : []),
    ...(isLibrarian ? [{ href: '/desk', label: 'Quầy thủ thư' }] : []),
    ...(isAdmin ? [{ href: '/admin/reports', label: 'Báo cáo & Hệ thống' }] : []),
    { href: '/dev/auth', label: 'Đăng nhập Dev' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-lg text-primary">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Library className="h-5 w-5" />
            </div>
            <span>NexusLib</span>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Auth Info / Actions */}
        <div className="flex items-center gap-3">
          {session ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col items-end text-xs">
                <span className="font-medium text-foreground">{session.user.email}</span>
                <div className="flex gap-1 mt-0.5">
                  {roles.map((r) => (
                    <Badge
                      key={r}
                      variant={r === 'admin' ? 'destructive' : r === 'librarian' ? 'default' : 'secondary'}
                      className="text-[10px] font-semibold py-0 h-4"
                    >
                      {ROLE_LABELS[r] || r}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => supabase.auth.signOut()}
                className="gap-1.5 text-xs"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </Button>
            </div>
          ) : (
            <Link href="/dev/auth">
              <Button size="sm" className="gap-1.5 text-xs">
                <LogIn className="h-3.5 w-3.5" />
                Đăng nhập
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
