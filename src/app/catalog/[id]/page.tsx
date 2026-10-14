'use client';

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  endpoints,
  type BookDetail,
  type Copy,
  type Me,
} from '@/lib/api/contract';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  BookmarkCheck,
  AlertCircle,
  Loader2,
  Plus,
  Edit,
  Wrench,
  Barcode,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }> = {
  available: { label: 'Sẵn sàng', variant: 'default' },
  on_loan: { label: 'Đang mượn', variant: 'secondary' },
  on_hold: { label: 'Đang giữ chỗ', variant: 'outline' },
  in_repair: { label: 'Đang sửa chữa', variant: 'destructive' },
  lost: { label: 'Báo mất', variant: 'destructive' },
  retired: { label: 'Đã thanh lý', variant: 'outline' },
};

const CONDITION_LABELS: Record<string, string> = {
  good: 'Nguyên vẹn',
  worn: 'Hơi cũ',
  damaged: 'Hư hỏng',
};

export default function BookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bookId = Number(id);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [copies, setCopies] = useState<Copy[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiesLoading, setCopiesLoading] = useState(false);

  // Reservation state
  const [reserving, setReserving] = useState(false);
  const [reserveMessage, setReserveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Modal: Đăng ký bản sao mới (registerCopy)
  const [isRegisterCopyOpen, setIsRegisterCopyOpen] = useState(false);
  const [newBarcode, setNewBarcode] = useState('');
  const [newShelfCode, setNewShelfCode] = useState('Kệ A1-01');
  const [newCondition, setNewCondition] = useState<'good' | 'worn' | 'damaged'>('good');
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  // Modal: Đổi trạng thái bản sao (changeCopyStatus)
  const [statusCopy, setStatusCopy] = useState<Copy | null>(null);
  const [targetStatus, setTargetStatus] = useState<'available' | 'in_repair' | 'retired'>('available');
  const [targetCondition, setTargetCondition] = useState<'good' | 'worn' | 'damaged'>('good');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  // Modal: Sửa đầu sách (updateBook)
  const [isEditBookOpen, setIsEditBookOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editYear, setEditYear] = useState<number>(2026);
  const [editReplacementCost, setEditReplacementCost] = useState<number>(100000);
  const [editDescription, setEditDescription] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
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

  const isStaff = useMemo(() => {
    const roles = me?.roles ?? [];
    return roles.includes('librarian') || roles.includes('admin');
  }, [me]);

  const loadBookDetail = useCallback(() => {
    if (!bookId) return;
    setLoading(true);
    apiFetch(endpoints.getCatalogBook, { params: { bookId } })
      .then((data) => {
        setBook(data);
        setEditTitle(data.title);
        setEditSubtitle(data.subtitle || '');
        setEditYear(data.publishedYear || 2026);
        setEditDescription(data.description || '');
      })
      .catch((err) => {
        console.error('Failed to load book', err);
        setBook(null);
      })
      .finally(() => setLoading(false));
  }, [bookId]);

  const loadCopies = useCallback(() => {
    if (!bookId || !session || !isStaff) return;
    setCopiesLoading(true);
    apiFetch(endpoints.listCopies, { params: { bookId } }, { token: session.access_token })
      .then((res) => setCopies(res.items))
      .catch((err) => console.error('Failed to load copies', err))
      .finally(() => setCopiesLoading(false));
  }, [bookId, session, isStaff]);

  useEffect(() => {
    loadBookDetail();
  }, [loadBookDetail]);

  useEffect(() => {
    if (isStaff) {
      loadCopies();
    }
  }, [isStaff, loadCopies]);

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
        text: `Đặt trước thành công! Mã yêu cầu đặt: #${res.id}, vị trí trong hàng đợi: #${res.queuePosition ?? 1}.`,
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

  // Đăng ký bản sao mới (sp_register_copy)
  const handleRegisterCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !isStaff || !book) return;
    setRegisterLoading(true);
    setRegisterError(null);
    setRegisterSuccess(null);
    try {
      const barcodeToUse = newBarcode.trim() || `BC-${book.id}-${Date.now().toString(36).toUpperCase()}`;
      await apiFetch(
        endpoints.registerCopy,
        {
          params: { bookId: book.id },
          body: {
            barcode: barcodeToUse,
            shelfCode: newShelfCode.trim() || undefined,
            condition: newCondition,
            acquiredAt: new Date().toISOString().split('T')[0],
          },
        },
        { token: session.access_token }
      );
      setRegisterSuccess(`Đã nhập kho thành công bản sao ${barcodeToUse}!`);
      setNewBarcode('');
      setTimeout(() => {
        setIsRegisterCopyOpen(false);
        setRegisterSuccess(null);
        loadCopies();
        loadBookDetail();
      }, 1000);
    } catch (err) {
      setRegisterError(err instanceof ApiClientError ? err.message : 'Không thể đăng ký bản sao.');
    } finally {
      setRegisterLoading(false);
    }
  };

  // Đổi trạng thái bản sao (sp_change_copy_status)
  const handleChangeStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !statusCopy) return;
    setChangeLoading(true);
    setChangeError(null);
    try {
      await apiFetch(
        endpoints.changeCopyStatus,
        {
          params: { copyId: statusCopy.id },
          body: {
            targetStatus,
            condition: targetCondition,
          },
        },
        { token: session.access_token }
      );
      setStatusCopy(null);
      loadCopies();
      loadBookDetail();
    } catch (err) {
      setChangeError(err instanceof ApiClientError ? err.message : 'Không thể đổi trạng thái.');
    } finally {
      setChangeLoading(false);
    }
  };

  // Cập nhật thông tin đầu sách (updateBook)
  const handleUpdateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !isStaff || !book) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await apiFetch(
        endpoints.updateBook,
        {
          params: { bookId: book.id },
          body: {
            title: editTitle.trim(),
            subtitle: editSubtitle.trim() || undefined,
            publishedYear: Number(editYear) || undefined,
            replacementCostVnd: Number(editReplacementCost) || 100000,
            description: editDescription.trim() || undefined,
          },
        },
        { token: session.access_token }
      );
      setIsEditBookOpen(false);
      loadBookDetail();
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : 'Không thể cập nhật sách.');
    } finally {
      setEditLoading(false);
    }
  };

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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Back button & Staff toolbar */}
      <div className="flex items-center justify-between">
        <Link href="/catalog" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium">
          <ArrowLeft className="h-3.5 w-3.5" />
          Quay lại danh mục sách
        </Link>

        {isStaff && (
          <div className="flex items-center gap-2">
            <Dialog open={isEditBookOpen} onOpenChange={setIsEditBookOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1.5 text-xs" />}>
                <Edit className="h-3.5 w-3.5" />
                Sửa thông tin sách
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleUpdateBook}>
                  <DialogHeader>
                    <DialogTitle>Chỉnh sửa thông tin đầu sách</DialogTitle>
                    <DialogDescription>Cập nhật tiêu đề, phụ đề, năm XB và mô tả.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-3 text-xs">
                    {editError && (
                      <div className="p-2 rounded bg-destructive/10 text-destructive border border-destructive/20">
                        {editError}
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="font-semibold">Tiêu đề sách</label>
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold">Phụ đề</label>
                      <Input value={editSubtitle} onChange={(e) => setEditSubtitle(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold">Năm xuất bản</label>
                        <Input
                          type="number"
                          value={editYear}
                          onChange={(e) => setEditYear(Number(e.target.value) || 2026)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Giá bồi hoàn (VNĐ)</label>
                        <Input
                          type="number"
                          value={editReplacementCost}
                          onChange={(e) => setEditReplacementCost(Number(e.target.value) || 100000)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold">Mô tả nội dung</label>
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-input bg-background p-2 text-xs"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsEditBookOpen(false)}>Hủy</Button>
                    <Button type="submit" disabled={editLoading}>
                      {editLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

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

      {/* ===================== PHÂN HỆ QUẢN LÝ BẢN SAO CHO THỦ THƯ ===================== */}
      {isStaff && (
        <div className="mt-12 rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Barcode className="h-5 w-5 text-primary" />
                Quản lý các bản sao vật lý trong kho
              </h2>
              <p className="text-xs text-muted-foreground">
                Tổng cộng {copies.length} bản sao · {copies.filter((c) => c.circulationStatus === 'available').length} sẵn sàng trên kệ.
              </p>
            </div>

            {/* Nút Đăng ký bản sao mới (sp_register_copy) */}
            <Dialog open={isRegisterCopyOpen} onOpenChange={setIsRegisterCopyOpen}>
              <DialogTrigger render={<Button size="sm" className="gap-1.5 text-xs shadow-xs" />}>
                <Plus className="h-4 w-4" />
                Nhập bản sao mới
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleRegisterCopy}>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Barcode className="h-5 w-5 text-primary" />
                      Đăng ký nhập kho bản sao mới
                    </DialogTitle>
                    <DialogDescription>
                      Thủ tục nhập kho thông qua stored procedure <code className="text-primary font-mono">sp_register_copy</code>.
                      Nếu có người đặt trước, sách sẽ tự động được giữ chỗ (on_hold).
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-3 py-3 text-xs">
                    {registerSuccess && (
                      <div className="p-2.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 shrink-0" />
                        <span>{registerSuccess}</span>
                      </div>
                    )}
                    {registerError && (
                      <div className="p-2.5 rounded bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{registerError}</span>
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="font-semibold">Mã vạch Barcode <span className="text-destructive">*</span></label>
                        <button
                          type="button"
                          onClick={() => setNewBarcode(`BC-${book.id}-${Date.now().toString(36).toUpperCase()}`)}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3" /> Tự sinh mã
                        </button>
                      </div>
                      <Input
                        placeholder="VD: BC-UIT-998877"
                        value={newBarcode}
                        onChange={(e) => setNewBarcode(e.target.value)}
                        required
                        className="font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold">Vị trí kệ sách (Shelf Code)</label>
                        <Input
                          placeholder="VD: Kệ A1-01"
                          value={newShelfCode}
                          onChange={(e) => setNewShelfCode(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold">Tình trạng vật lý khi nhập</label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs"
                          value={newCondition}
                          onChange={(e) => setNewCondition(e.target.value as any)}
                        >
                          <option value="good">Nguyên vẹn (good)</option>
                          <option value="worn">Hơi cũ (worn)</option>
                          <option value="damaged">Hư hỏng (damaged - sẽ vào in_repair)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsRegisterCopyOpen(false)}>Hủy</Button>
                    <Button type="submit" disabled={registerLoading}>
                      {registerLoading ? 'Đang nhập kho...' : 'Xác nhận nhập kho'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Danh sách các cuốn sách vật lý */}
          {copiesLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Đang tải danh sách bản sao...
            </div>
          ) : copies.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Đầu sách này chưa có bản sao vật lý nào trong kho. Hãy bấm "Nhập bản sao mới" để nhập sách.
            </div>
          ) : (
            <div className="divide-y rounded-lg border text-xs overflow-hidden">
              <div className="grid grid-cols-5 p-3 font-semibold bg-muted/40 text-muted-foreground text-[11px]">
                <span>MÃ VẠCH (BARCODE)</span>
                <span>VỊ TRÍ KỆ</span>
                <span>TÌNH TRẠNG VẬT LÝ</span>
                <span>TRẠNG THÁI LƯU THÔNG</span>
                <span className="text-right">THAO TÁC</span>
              </div>
              {copies.map((copy) => {
                const statusMeta = STATUS_LABELS[copy.circulationStatus] || { label: copy.circulationStatus, variant: 'outline' };
                return (
                  <div key={copy.id} className="grid grid-cols-5 p-3 items-center">
                    <span className="font-mono font-bold text-foreground">{copy.barcode}</span>
                    <span className="text-muted-foreground">{copy.shelfCode || '—'}</span>
                    <span>
                      <Badge variant="outline" className="text-[10px]">
                        {CONDITION_LABELS[copy.physicalCondition] || copy.physicalCondition}
                      </Badge>
                    </span>
                    <span>
                      <Badge variant={statusMeta.variant} className="text-[10px]">
                        {statusMeta.label}
                      </Badge>
                    </span>
                    <div className="text-right">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setStatusCopy(copy);
                          setTargetStatus(copy.circulationStatus === 'in_repair' ? 'available' : 'in_repair');
                          setTargetCondition(copy.physicalCondition);
                          setChangeError(null);
                        }}
                        disabled={copy.circulationStatus === 'on_loan' || copy.circulationStatus === 'retired'}
                        className="text-[11px] h-7 gap-1"
                        title={copy.circulationStatus === 'on_loan' ? 'Sách đang cho mượn không thể đổi trạng thái bảo trì' : 'Đổi trạng thái bảo trì'}
                      >
                        <Wrench className="h-3 w-3" />
                        Đổi trạng thái
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Đổi trạng thái bảo trì bản sao (sp_change_copy_status) */}
      <Dialog open={!!statusCopy} onOpenChange={(open) => !open && setStatusCopy(null)}>
        <DialogContent>
          <form onSubmit={handleChangeStatus}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Cập nhật bảo trì bản sao {statusCopy?.barcode}
              </DialogTitle>
              <DialogDescription>
                Thủ tục bảo dưỡng / phục hồi sách qua <code className="text-primary font-mono">sp_change_copy_status</code>.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-3 text-xs">
              {changeError && (
                <div className="p-2 rounded bg-destructive/10 text-destructive border border-destructive/20">
                  {changeError}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold">Trạng thái mục tiêu</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs"
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as any)}
                >
                  <option value="available">Sẵn sàng lưu thông (available - đã sửa xong / tìm thấy)</option>
                  <option value="in_repair">Đang sửa chữa bảo dưỡng (in_repair)</option>
                  <option value="retired">Thanh lý loại bỏ (retired)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold">Tình trạng vật lý sau bảo trì</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs"
                  value={targetCondition}
                  onChange={(e) => setTargetCondition(e.target.value as any)}
                >
                  <option value="good">Nguyên vẹn (good)</option>
                  <option value="worn">Hơi cũ (worn)</option>
                  <option value="damaged">Hư hỏng (damaged)</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStatusCopy(null)}>Hủy</Button>
              <Button type="submit" disabled={changeLoading}>
                {changeLoading ? 'Đang cập nhật...' : 'Xác nhận thay đổi'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
