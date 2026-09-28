'use client';

import { use, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { endpoints, type BookDetail } from '@/lib/api/contract';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  BookmarkCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

export default function BookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bookId = Number(id);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);
  const [reserveMessage, setReserveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, [supabase]);

  useEffect(() => {
    if (!bookId) return;
    setLoading(true);
    apiFetch(endpoints.getCatalogBook, { params: { bookId } })
      .then(setBook)
      .catch((err) => {
        console.error('Failed to load book', err);
        setBook(null);
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  async function handleReserve() {
    if (!session) {
      setReserveMessage({ ok: false, text: 'Vui lòng đăng nhập để đặt trước đầu sách này.' });
      return;
    }
    setReserving(true);
    setReserveMessage(null);
    try {
      const meData = await apiFetch(endpoints.me, {}, { token: session.access_token });
      if (!meData.reader?.id) {
        setReserveMessage({ ok: false, text: 'Tài khoản của bạn chưa được liên kết với hồ sơ bạn đọc.' });
        return;
      }
      const res = await apiFetch(
        endpoints.reserve,
        { body: { readerId: meData.reader.id, bookId } },
        { token: session.access_token }
      );
      setReserveMessage({
        ok: true,
        text: `Đặt trước thành công! Mã yêu cầu đặt: #${res.id}, vị trí trong hàng đợi: #${res.queuePosition}.`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không thể đặt trước sách. Vui lòng thử lại sau.';
      setReserveMessage({ ok: false, text: msg });
    } finally {
      setReserving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Đang tải thông tin sách...</p>
      </main>
    );
  }

  if (!book) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="text-xl font-bold">Không tìm thấy sách</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Đầu sách yêu cầu không tồn tại hoặc đã ngừng lưu hành trong thư viện.
        </p>
        <Link href="/catalog" className="mt-6 inline-block">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Quay lại danh mục
          </Button>
        </Link>
      </main>
    );
  }

  const isAvailable = book.copies.available > 0;
  const authorsText = book.authors.map((a) => a.name).join(', ') || 'Tác giả chưa cập nhật';
  const materialLabel = book.materialType === 'BOOK_PRINT' ? 'Sách in' : book.materialType;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back button */}
      <Link href="/catalog" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 font-medium">
        <ArrowLeft className="h-3.5 w-3.5" />
        Quay lại danh mục sách
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Cover & Quick Action */}
        <div className="flex flex-col items-center">
          <div className="relative aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-xl border bg-muted/40 shadow-md">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <BookOpen className="h-16 w-16 mb-2 text-primary/30" />
                <span className="text-xs font-semibold uppercase tracking-wider">{book.title}</span>
              </div>
            )}
          </div>

          {/* Quick Action: Reservation */}
          <div className="mt-6 w-full max-w-[280px] space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <span className="text-xs font-medium text-muted-foreground">Tình trạng sách</span>
              <Badge
                variant={isAvailable ? 'default' : 'secondary'}
                className={isAvailable ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}
              >
                {isAvailable ? `Còn ${book.copies.available} / ${book.copies.total} cuốn` : 'Đã mượn hết'}
              </Badge>
            </div>

            {!isAvailable && (
              <Button
                onClick={handleReserve}
                disabled={reserving}
                className="w-full gap-2 text-xs"
              >
                {reserving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BookmarkCheck className="h-4 w-4" />
                )}
                Đặt trước đầu sách này
              </Button>
            )}

            {reserveMessage && (
              <div
                className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
                  reserveMessage.ok
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                }`}
              >
                {reserveMessage.ok ? (
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{reserveMessage.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Bibliographic Details */}
        <div className="md:col-span-2 space-y-6">
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {book.categories.map((c) => (
                <Badge key={c.id} variant="secondary" className="text-xs">
                  {c.name}
                </Badge>
              ))}
              <Badge variant="outline" className="text-xs font-mono">
                {materialLabel}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {book.title}
            </h1>
            {book.subtitle && (
              <p className="mt-1 text-base text-muted-foreground font-medium">{book.subtitle}</p>
            )}
            <p className="mt-2 text-sm text-foreground/80 font-medium">
              Tác giả: <span className="text-primary">{authorsText}</span>
            </p>
          </div>

          <Separator />

          {/* Description */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Tóm tắt nội dung
            </h2>
            <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-relaxed">
              {book.description ? (
                <p className="whitespace-pre-line">{book.description}</p>
              ) : (
                <p className="italic text-muted-foreground/60">Chưa có thông tin tóm tắt cho đầu sách này.</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Metadata Grid */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Thông tin chi tiết
            </h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Nhà xuất bản</dt>
                <dd className="font-medium text-foreground mt-0.5">
                  {book.publisher?.name || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Năm xuất bản</dt>
                <dd className="font-medium text-foreground mt-0.5">
                  {book.publishedYear || book.publishedDateText || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ngôn ngữ</dt>
                <dd className="font-medium text-foreground mt-0.5 uppercase">
                  {book.languageCode || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mã phân loại (DDC)</dt>
                <dd className="font-medium text-foreground mt-0.5 font-mono">
                  {book.classificationCode || '—'}
                </dd>
              </div>
              {book.identifiers.map((ident) => (
                <div key={ident.value}>
                  <dt className="text-muted-foreground">{ident.type.replace('_', ' ')}</dt>
                  <dd className="font-medium text-foreground mt-0.5 font-mono">{ident.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
