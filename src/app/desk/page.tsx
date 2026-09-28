'use client';

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import {
  endpoints,
  type CardScan,
  type CopyScan,
  type Me,
  type LoanItem,
} from '@/lib/api/contract';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Library,
  Barcode,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Loader2,
  ShieldAlert,
  Trash2,
  Sparkles,
  BookOpen,
  ArrowRight,
  RotateCcw,
  Clock,
  PlusCircle,
  Undo2,
  Users,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

const CONDITION_LABELS: Record<string, string> = {
  good: 'Nguyên vẹn',
  worn: 'Hơi cũ',
  damaged: 'Hư hỏng / Rách',
};

const READER_TYPE_LABELS: Record<string, string> = {
  STUDENT: 'Sinh viên',
  LECTURER: 'Giảng viên',
  EXTERNAL: 'Bạn đọc ngoài',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Hoạt động',
  suspended: 'Bị tạm khóa',
  inactive: 'Ngưng kích hoạt',
  available: 'Sẵn sàng trên giá',
  on_loan: 'Đang cho mượn',
  in_repair: 'Đang phục hồi',
  lost: 'Đã báo mất',
  retired: 'Thanh lý',
};

// Sách mẫu có sẵn trong kho seed để chọn nhanh 1 chạm
const POPULAR_AVAILABLE_COPIES = [
  { barcode: 'M001', title: 'Clean Code', author: 'Robert C. Martin', shelf: 'Kệ A1-01' },
  { barcode: 'M004', title: 'The Pragmatic Programmer', author: 'David Thomas', shelf: 'Kệ A1-02' },
  { barcode: 'M007', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', shelf: 'Kệ B2-01' },
  { barcode: 'M010', title: 'Introduction to Algorithms (CLRS)', author: 'Cormen et al.', shelf: 'Kệ C1-01' },
  { barcode: 'M013', title: 'Artificial Intelligence: Modern Approach', author: 'Russell & Norvig', shelf: 'Kệ C2-01' },
  { barcode: 'M016', title: 'Computer Networking: Top-Down', author: 'Kurose & Ross', shelf: 'Kệ D1-01' },
  { barcode: 'M019', title: 'Operating System Concepts', author: 'Silberschatz', shelf: 'Kệ D2-01' },
  { barcode: 'M022', title: 'Database System Concepts', author: 'Silberschatz', shelf: 'Kệ B1-01' },
];

// Bạn đọc mẫu có sẵn trong cơ sở dữ liệu
const SAMPLE_READERS = [
  { cardNumber: 'C2026-0001', name: 'Nguyễn Văn An', role: 'Sinh viên', desc: 'Hạn mức 5 cuốn · Nợ 0đ' },
  { cardNumber: 'C2026-0002', name: 'Nguyễn Thị Hồng', role: 'Giảng viên', desc: 'Hạn mức 10 cuốn · Nợ 0đ' },
  { cardNumber: 'C2026-0003', name: 'Vũ Hải Nam', role: 'Bạn đọc ngoài', desc: 'Hạn mức 3 cuốn · Nợ 0đ' },
];

function CirculationDeskInner() {
  const searchParams = useSearchParams();
  const cardParam = searchParams.get('card');
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- Checkout State ---
  const [cardNumber, setCardNumber] = useState(cardParam || 'C2026-0001');
  const [cardScan, setCardScan] = useState<CardScan | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [copyBarcode, setCopyBarcode] = useState('');
  const [scannedCopies, setScannedCopies] = useState<(CopyScan & { title?: string; author?: string })[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{ loanId: number; items: { loanItemId: number; copyId: number; dueAt: string }[] } | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Sách độc giả đang mượn (để hiển thị trực quan)
  const [activeLoans, setActiveLoans] = useState<LoanItem[]>([]);
  const [loadingActiveLoans, setLoadingActiveLoans] = useState(false);

  // --- Return State ---
  const [returnBarcode, setReturnBarcode] = useState('');
  const [returnCopyScan, setReturnCopyScan] = useState<CopyScan | null>(null);
  const [returnCondition, setReturnCondition] = useState<'good' | 'worn' | 'damaged'>('good');
  const [damageFee, setDamageFee] = useState<number>(0);
  const [damageReason, setDamageReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnResult, setReturnResult] = useState<{ action: string; fines?: any[] } | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('checkout');

  // Check staff session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setAuthLoading(false);
      return;
    }
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(setMe)
      .catch((err) => console.error('Failed to load staff permissions', err))
      .finally(() => setAuthLoading(false));
  }, [session]);

  const roles = me?.roles ?? [];
  const isAuthorized = roles.includes('librarian') || roles.includes('admin');

  // Load reader active loans when card is scanned
  const loadReaderActiveLoans = useCallback(async (readerId: number) => {
    if (!session) return;
    setLoadingActiveLoans(true);
    try {
      const res = await apiFetch(
        endpoints.readerLoanItems,
        { params: { readerId }, query: { status: 'on_loan', page: 1, pageSize: 20 } },
        { token: session.access_token }
      );
      setActiveLoans(res.items);
    } catch {
      setActiveLoans([]);
    } finally {
      setLoadingActiveLoans(false);
    }
  }, [session]);

  // --- Checkout Handlers ---
  const handleLookupCard = useCallback(async (cardToLookup?: string) => {
    const code = (cardToLookup || cardNumber).trim();
    if (!session || !code) return;
    setCardLoading(true);
    setCheckoutError(null);
    setCheckoutResult(null);
    try {
      const res = await apiFetch(
        endpoints.cardByNumber,
        { params: { cardNumber: code } },
        { token: session.access_token }
      );
      setCardScan(res);
      setCardNumber(code);
      loadReaderActiveLoans(res.reader.id);
    } catch (err) {
      setCardScan(null);
      setActiveLoans([]);
      setCheckoutError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không tìm thấy thẻ bạn đọc hoặc thẻ không hợp lệ.'
      );
    } finally {
      setCardLoading(false);
    }
  }, [cardNumber, session, loadReaderActiveLoans]);

  // Tự động kiểm tra thẻ mặc định lần đầu nếu có hoặc từ query param
  useEffect(() => {
    if (session && isAuthorized) {
      if (cardParam) {
        setCardNumber(cardParam);
        handleLookupCard(cardParam);
      } else if (!cardScan && cardNumber) {
        handleLookupCard(cardNumber);
      }
    }
  }, [session, isAuthorized, cardParam]);

  const handleAddCopyByBarcode = useCallback(async (barcodeToAdd: string, bookMeta?: { title: string; author: string }) => {
    const code = barcodeToAdd.trim();
    if (!session || !code) return;
    setCheckoutError(null);
    try {
      const copy = await apiFetch(
        endpoints.copyByBarcode,
        { params: { barcode: code } },
        { token: session.access_token }
      );
      if (scannedCopies.some((c) => c.id === copy.id)) {
        setCheckoutError(`Cuốn sách mã [${code}] đã có trong lượt mượn hiện tại.`);
        return;
      }
      if (copy.circulationStatus !== 'available') {
        setCheckoutError(`Bản sao [${code}] hiện không sẵn sàng để mượn (Trạng thái: ${STATUS_LABELS[copy.circulationStatus] || copy.circulationStatus}).`);
        return;
      }
      setScannedCopies((prev) => [
        ...prev,
        {
          ...copy,
          title: bookMeta?.title || `Ấn phẩm (${copy.barcode})`,
          author: bookMeta?.author || '',
        },
      ]);
      setCopyBarcode('');
    } catch (err) {
      setCheckoutError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : `Không tìm thấy mã vạch [${code}] trong kho thư viện.`
      );
    }
  }, [session, scannedCopies]);

  async function handleCheckout() {
    if (!session || !cardScan || scannedCopies.length === 0) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    setCheckoutResult(null);
    try {
      const res = await apiFetch(
        endpoints.checkout,
        {
          body: {
            readerId: cardScan.reader.id,
            copyIds: scannedCopies.map((c) => c.id),
          },
        },
        { token: session.access_token }
      );
      setCheckoutResult(res);
      setScannedCopies([]);
      // Reload reader loans
      loadReaderActiveLoans(cardScan.reader.id);
    } catch (err) {
      setCheckoutError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không thể thực hiện mượn sách. Vui lòng kiểm tra lại điều kiện thẻ hoặc số sách tối đa.'
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  // --- Return Handlers ---
  const handleLookupReturnCopy = useCallback(async (codeToLookup?: string) => {
    const code = (codeToLookup || returnBarcode).trim();
    if (!session || !code) return;
    setReturnError(null);
    setReturnResult(null);
    try {
      const res = await apiFetch(
        endpoints.copyByBarcode,
        { params: { barcode: code } },
        { token: session.access_token }
      );
      setReturnCopyScan(res);
      setReturnBarcode(code);
    } catch (err) {
      setReturnCopyScan(null);
      setReturnError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : `Không tìm thấy bản sao sách theo mã vạch [${code}].`
      );
    }
  }, [session, returnBarcode]);

  async function handleProcessReturn() {
    if (!session || !returnCopyScan?.openLoanItemId) return;
    setReturnLoading(true);
    setReturnError(null);
    try {
      const res = await apiFetch(
        endpoints.returnItem,
        {
          params: { loanItemId: returnCopyScan.openLoanItemId },
          body: {
            condition: returnCondition,
            damagedFineVnd: returnCondition === 'damaged' && damageFee > 0 ? damageFee : undefined,
            reason: returnCondition === 'damaged' ? damageReason : undefined,
          },
        },
        { token: session.access_token }
      );
      setReturnResult({ action: 'return', fines: res.fines });
      setReturnCopyScan(null);
      setReturnBarcode('');
      if (cardScan) {
        loadReaderActiveLoans(cardScan.reader.id);
      }
    } catch (err) {
      setReturnError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không thể hoàn tất trả sách.'
      );
    } finally {
      setReturnLoading(false);
    }
  }

  async function handleDeclareLost() {
    if (!session || !returnCopyScan?.openLoanItemId) return;
    setReturnLoading(true);
    setReturnError(null);
    try {
      const res = await apiFetch(
        endpoints.declareLost,
        {
          params: { loanItemId: returnCopyScan.openLoanItemId },
          body: {
            reason: damageReason || 'Bạn đọc báo mất sách tại quầy thủ thư',
          },
        },
        { token: session.access_token }
      );
      setReturnResult({ action: 'lost', fines: res.fines });
      setReturnCopyScan(null);
      setReturnBarcode('');
      if (cardScan) {
        loadReaderActiveLoans(cardScan.reader.id);
      }
    } catch (err) {
      setReturnError(
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không thể ghi nhận báo mất sách.'
      );
    } finally {
      setReturnLoading(false);
    }
  }

  if (authLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-xs text-muted-foreground">Đang xác thực quyền thủ thư...</p>
      </main>
    );
  }

  if (!session || !isAuthorized) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="rounded-2xl border bg-card p-8 shadow-xs">
          <ShieldAlert className="mx-auto h-12 w-12 text-destructive mb-3" />
          <h2 className="text-xl font-bold">Khu Vực Quầy Dành Cho Thủ Thư</h2>
          <p className="text-muted-foreground mt-2 text-xs">
            Bạn cần đăng nhập bằng tài khoản có quyền <b>thủ thư (librarian)</b> hoặc <b>quản trị (admin)</b> để thực hiện xuất mượn / nhận trả sách.
          </p>
          <Link href="/dev/auth" className="mt-6 block">
            <Button className="w-full text-xs">Đăng nhập tài khoản account+librarian@gmail.com</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl flex items-center gap-2">
            <Library className="h-7 w-7 text-primary" />
            Quầy Lưu Thông Thủ Thư (Circulation Desk)
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Nghiệp vụ quầy: Quét thẻ xuất mượn tài liệu, nhận trả sách, kiểm định hư hại, báo mất và xử lý công nợ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/desk/readers">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
              <Users className="h-3.5 w-3.5 text-primary" />
              Quản lý bạn đọc
            </Button>
          </Link>
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
            Thủ Thư Đang Trực: {session?.user.email}
          </Badge>
        </div>
      </div>

      {/* QUICK PRESET BAR: Hỗ trợ 1-click test cực tiện lợi */}
      <div className="rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-muted/40 p-3.5 sm:p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Thao tác nhanh 1 chạm (Quick Pick)</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Nhấn để chọn nhanh bạn đọc mẫu từ cơ sở dữ liệu mà không cần gõ mã thủ công:
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_READERS.map((sr) => (
              <Button
                key={sr.cardNumber}
                variant={cardNumber === sr.cardNumber && cardScan ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleLookupCard(sr.cardNumber)}
                disabled={cardLoading}
                className="h-8 text-xs gap-1.5 shadow-2xs"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>{sr.name}</span>
                <span className="opacity-70 text-[10px]">({sr.cardNumber})</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="checkout" className="gap-2 text-xs">
            <Barcode className="h-4 w-4" />
            Xuất Mượn Sách
          </TabsTrigger>
          <TabsTrigger value="return" className="gap-2 text-xs">
            <CheckCircle className="h-4 w-4" />
            Nhận Trả & Báo Mất
          </TabsTrigger>
        </TabsList>

        {/* ===================== TAB 1: CHECKOUT ===================== */}
        <TabsContent value="checkout" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* CỘT TRÁI: Bước 1 (Quét Thẻ) & Bước 2 (Quét Barcode / Chọn Sách) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Bước 1: Quét Mã Thẻ Bạn Đọc */}
              <Card className="border shadow-xs">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2 font-bold">
                      <CreditCard className="h-4 w-4 text-primary" />
                      Bước 1: Quét Mã Thẻ Bạn Đọc
                    </CardTitle>
                    {cardScan && (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 text-[10px]">
                        ✓ Thẻ hợp lệ
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    Quét hoặc nhập mã thẻ bạn đọc (Ví dụ: C2026-0001, C2026-0002).
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nhập mã thẻ bạn đọc (C2026-0001)..."
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLookupCard()}
                      className="font-mono text-xs sm:text-sm h-10"
                    />
                    <Button size="sm" onClick={() => handleLookupCard()} disabled={cardLoading} className="h-10 px-4 text-xs font-semibold gap-1.5">
                      {cardLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Kiểm tra
                    </Button>
                  </div>

                  {/* Chi tiết bạn đọc sau khi quét */}
                  {cardScan && (
                    <div className="rounded-lg border bg-muted/40 p-3.5 text-xs space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="space-y-0.5">
                          <span className="font-bold text-sm text-foreground">{cardScan.reader.fullName}</span>
                          <span className="block text-[11px] text-muted-foreground font-mono">
                            Email: {cardScan.reader.email || 'Chưa cập nhật'} · SĐT: {cardScan.reader.phone || 'Chưa cập nhật'}
                          </span>
                        </div>
                        <Badge variant="secondary" className="font-semibold text-xs">
                          {READER_TYPE_LABELS[cardScan.reader.readerType] || cardScan.reader.readerType}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t text-[11px]">
                        <div>
                          Trạng thái độc giả:{' '}
                          <span className="font-semibold text-foreground">
                            {STATUS_LABELS[cardScan.reader.status] || cardScan.reader.status}
                          </span>
                        </div>
                        <div>
                          Hiệu lực thẻ:{' '}
                          <span className={cardScan.validNow ? 'text-emerald-600 font-bold' : 'text-destructive font-bold'}>
                            {cardScan.validNow ? 'Đủ điều kiện mượn' : 'Thẻ hết hạn / Khóa'}
                          </span>
                        </div>
                      </div>

                      {/* Hiển thị sách độc giả đang mượn nếu có */}
                      {loadingActiveLoans ? (
                        <div className="pt-2 text-center text-muted-foreground text-[11px]">
                          <Loader2 className="h-3 w-3 inline animate-spin mr-1" />
                          Đang tải các sách đang mượn...
                        </div>
                      ) : activeLoans.length > 0 ? (
                        <div className="pt-2 border-t space-y-1.5">
                          <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                            <span>Sách đang mượn ({activeLoans.length} cuốn):</span>
                            <span className="text-[10px] text-amber-600 font-normal">Hạn trả gần nhất</span>
                          </div>
                          <div className="space-y-1.5">
                            {activeLoans.map((loan) => (
                              <div
                                key={loan.id}
                                className="flex items-center justify-between bg-background rounded p-1.5 border text-[11px] gap-2"
                              >
                                <div className="truncate flex-1">
                                  <span className="font-medium truncate block">{loan.book.title}</span>
                                  <span className="font-mono text-muted-foreground text-[10px]">
                                    {loan.copy.barcode ? `Mã: ${loan.copy.barcode} · ` : ''}Hạn:{' '}
                                    {new Date(loan.dueAt).toLocaleDateString('vi-VN')}
                                  </span>
                                </div>
                                {loan.copy.barcode && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => {
                                      handleLookupReturnCopy(loan.copy.barcode);
                                      setActiveTab('return');
                                    }}
                                    className="h-6 text-[10px] shrink-0 gap-1 text-primary hover:text-primary"
                                    title="Chuyển sang nhận trả cuốn sách này"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Trả sách này
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Bước 2: Quét Mã Vạch Sách */}
              <Card className="border shadow-xs">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 font-bold">
                    <Barcode className="h-4 w-4 text-primary" />
                    Bước 2: Quét Hoặc Chọn Nhanh Mã Vạch Sách
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Quét mã vạch cuốn sách hoặc nhấp trực tiếp vào danh sách sách có sẵn bên dưới.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-4">
                  {/* Ô nhập Barcode cho súng quét */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Quét mã vạch (ví dụ: M001, M004, M007)..."
                      value={copyBarcode}
                      onChange={(e) => setCopyBarcode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCopyByBarcode(copyBarcode)}
                      className="font-mono text-xs sm:text-sm h-10"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleAddCopyByBarcode(copyBarcode)}
                      className="h-10 px-4 text-xs font-semibold gap-1.5"
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                      Thêm mã
                    </Button>
                  </div>

                  {/* KHỐI CHỌN NHANH SÁCH CÓ SẴN (WOW UX) */}
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-primary" />
                        Sách sẵn có trên giá (Nhấn để thêm vào phiếu):
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">Bản sao sẵn sàng</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {POPULAR_AVAILABLE_COPIES.map((book) => {
                        const isAdded = scannedCopies.some((c) => c.barcode === book.barcode);
                        return (
                          <button
                            key={book.barcode}
                            type="button"
                            disabled={isAdded}
                            onClick={() => handleAddCopyByBarcode(book.barcode, { title: book.title, author: book.author })}
                            className={`flex flex-col text-left p-2 rounded-md border text-xs transition-all ${
                              isAdded
                                ? 'bg-primary/5 border-primary/40 opacity-70 cursor-not-allowed'
                                : 'bg-background hover:bg-primary/5 hover:border-primary/50 cursor-pointer shadow-2xs'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-[11px] text-primary">{book.barcode}</span>
                              <Badge variant={isAdded ? 'secondary' : 'outline'} className="text-[9px] py-0 px-1">
                                {isAdded ? 'Đã thêm' : '+ Thêm'}
                              </Badge>
                            </div>
                            <span className="font-semibold text-foreground truncate mt-0.5">{book.title}</span>
                            <span className="text-[10px] text-muted-foreground">{book.shelf}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* CỘT PHẢI: GIỎ MƯỢN SÁCH & XÁC NHẬN (BORROW CART) */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="border shadow-xs h-full flex flex-col justify-between">
                <div>
                  <CardHeader className="p-4 pb-3 border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <span>Danh Sách Xuất Mượn</span>
                        <Badge variant="default" className="text-xs">
                          {scannedCopies.length} cuốn
                        </Badge>
                      </CardTitle>
                      {scannedCopies.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setScannedCopies([])}
                          className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Xóa hết
                        </Button>
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      Các cuốn sách chuẩn bị giao cho bạn đọc: {cardScan ? cardScan.reader.fullName : 'Chưa quét thẻ'}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 space-y-3">
                    {scannedCopies.length === 0 ? (
                      <div className="py-12 text-center space-y-2">
                        <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                        <p className="text-xs text-muted-foreground">Chưa có cuốn sách nào trong lượt mượn này.</p>
                        <p className="text-[11px] text-muted-foreground/70">
                          Nhấn vào các sách gợi ý ở bên trái để thêm ngay vào đây.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                        {scannedCopies.map((cp, idx) => (
                          <div
                            key={cp.id}
                            className="flex items-start justify-between rounded-lg border bg-card p-3 text-xs shadow-2xs gap-2"
                          >
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs bg-muted px-1.5 py-0.5 rounded">
                                  {cp.barcode}
                                </span>
                                <Badge variant="outline" className="text-[10px] py-0">
                                  {CONDITION_LABELS[cp.physicalCondition] || cp.physicalCondition}
                                </Badge>
                              </div>
                              <p className="font-semibold text-foreground truncate">{cp.title}</p>
                              <p className="text-[11px] text-muted-foreground">Vị trí: {cp.shelfCode || 'Kệ chính'}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setScannedCopies(scannedCopies.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </div>

                <div className="p-4 border-t space-y-3 bg-muted/10">
                  {/* Lỗi nếu có */}
                  {checkoutError && (
                    <div className="rounded-lg p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{checkoutError}</span>
                    </div>
                  )}

                  {/* Thành công */}
                  {checkoutResult && (
                    <div className="rounded-lg p-3.5 text-xs bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        Xuất mượn thành công! (Phiếu #{checkoutResult.loanId})
                      </div>
                      <div className="space-y-1 pl-6">
                        {checkoutResult.items.map((it) => (
                          <div key={it.loanItemId} className="flex justify-between">
                            <span>Bản sao #{it.copyId}:</span>
                            <span className="font-mono font-bold">
                              Hạn trả: {new Date(it.dueAt).toLocaleDateString('vi-VN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    size="lg"
                    disabled={!cardScan || scannedCopies.length === 0 || checkoutLoading}
                    onClick={handleCheckout}
                    className="w-full text-xs sm:text-sm font-semibold h-11 gap-2 shadow-xs"
                  >
                    {checkoutLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}
                    Xác Nhận Xuất Mượn ({scannedCopies.length} cuốn)
                  </Button>
                </div>
              </Card>
            </div>

          </div>
        </TabsContent>

        {/* ===================== TAB 2: RETURNS & LOST ===================== */}
        <TabsContent value="return" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Form quét và nhận trả */}
            <Card className="border shadow-xs">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-primary" />
                  Quét Mã Vạch Sách Cần Trả
                </CardTitle>
                <CardDescription className="text-xs">
                  Nhập mã vạch cuốn sách để kiểm tra lượt mượn đang mở và thẩm định tình trạng vật lý.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nhập mã vạch cần trả (ví dụ: M001, M004)..."
                    value={returnBarcode}
                    onChange={(e) => setReturnBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLookupReturnCopy()}
                    className="font-mono text-xs sm:text-sm h-10"
                  />
                  <Button size="sm" onClick={() => handleLookupReturnCopy()} className="h-10 px-4 text-xs font-semibold gap-1.5">
                    Kiểm tra
                  </Button>
                </div>

                {/* Sách mẫu gợi ý để test trả nhanh */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <span className="text-[11px] font-semibold text-muted-foreground block">
                    Gợi ý mã vạch mẫu để kiểm thử:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {['M001', 'M004', 'M007', 'M010', 'M013', 'M016'].map((b) => (
                      <Button
                        key={b}
                        variant="outline"
                        size="sm"
                        onClick={() => handleLookupReturnCopy(b)}
                        className="h-7 text-xs font-mono"
                      >
                        {b}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Kết quả quét cuốn sách cần trả */}
                {returnCopyScan && (
                  <div className="rounded-lg border bg-muted/40 p-4 space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        <span className="font-bold font-mono text-sm text-foreground">{returnCopyScan.barcode}</span>
                        <span className="block text-[11px] text-muted-foreground">Kệ sách: {returnCopyScan.shelfCode || '—'}</span>
                      </div>
                      <Badge variant="outline" className="font-semibold">
                        {STATUS_LABELS[returnCopyScan.circulationStatus] || returnCopyScan.circulationStatus}
                      </Badge>
                    </div>

                    {returnCopyScan.openLoanItemId ? (
                      <div className="space-y-3 pt-3 border-t">
                        <div className="text-xs font-bold text-foreground">1. Thẩm định tình trạng sách khi nhận lại:</div>
                        <div className="flex gap-2">
                          {(['good', 'worn', 'damaged'] as const).map((cond) => (
                            <Button
                              key={cond}
                              size="sm"
                              type="button"
                              variant={returnCondition === cond ? 'default' : 'outline'}
                              onClick={() => setReturnCondition(cond)}
                              className="text-xs h-8 flex-1"
                            >
                              {CONDITION_LABELS[cond]}
                            </Button>
                          ))}
                        </div>

                        {returnCondition === 'damaged' && (
                          <div className="space-y-2 rounded border border-destructive/20 bg-destructive/5 p-3">
                            <label className="text-xs font-semibold text-destructive">Mức phạt bồi thường hư hại (VNĐ):</label>
                            <Input
                              type="number"
                              value={damageFee}
                              onChange={(e) => setDamageFee(Number(e.target.value))}
                              placeholder="ví dụ: 50000"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-xs font-medium">Ghi chú hoặc lý do (tùy chọn):</label>
                          <Input
                            value={damageReason}
                            onChange={(e) => setDamageReason(e.target.value)}
                            placeholder="Ghi nhận rách gáy, ướt trang..."
                            className="h-8 text-xs"
                          />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <Button
                            size="sm"
                            disabled={returnLoading}
                            onClick={handleProcessReturn}
                            className="flex-1 gap-1.5 text-xs h-9 font-semibold"
                          >
                            {returnLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Xác Nhận Nhận Trả Sách
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={returnLoading}
                            onClick={handleDeclareLost}
                            className="gap-1.5 text-xs h-9 font-semibold"
                          >
                            Ghi Nhận Báo Mất
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded p-3 bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                        ⚠️ Bản sao này hiện đang có trạng thái <b>{STATUS_LABELS[returnCopyScan.circulationStatus]}</b>, không có lượt mượn nào đang mở để nhận trả.
                      </div>
                    )}
                  </div>
                )}

                {/* Thông báo lỗi */}
                {returnError && (
                  <div className="rounded-lg p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{returnError}</span>
                  </div>
                )}

                {/* Thông báo trả thành công */}
                {returnResult && (
                  <div className="rounded-lg p-4 text-xs bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                      {returnResult.action === 'lost' ? 'Đã ghi nhận sách bị mất!' : 'Đã hoàn tất thủ tục nhận trả sách!'}
                    </div>
                    {returnResult.fines && returnResult.fines.length > 0 ? (
                      <div className="space-y-1 pl-6">
                        <p className="font-semibold text-destructive">Khoản phạt phát sinh:</p>
                        <ul className="list-disc space-y-0.5">
                          {returnResult.fines.map((f: any) => (
                            <li key={f.fineId}>
                              Phạt {f.fineType === 'late' ? 'trễ hạn' : f.fineType === 'damaged' ? 'hư hỏng' : 'mất sách'}:{' '}
                              <b>{f.assessedAmountVnd.toLocaleString('vi-VN')} đ</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-emerald-700 dark:text-emerald-400 pl-6">Sách trả đúng hạn và nguyên vẹn. Không có tiền phạt.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Hướng dẫn quy trình lưu thông */}
            <Card className="border shadow-xs">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Quy Trình Nghiệp Vụ Tại Quầy Thủ Thư
                </CardTitle>
                <CardDescription className="text-xs">
                  Tuân thủ các nguyên tắc toàn vẹn dữ liệu của đồ án Cơ sở Dữ liệu UIT.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-3 text-xs text-muted-foreground leading-relaxed">
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="font-semibold text-foreground block">1. Kiểm Tra Điều Kiện Mượn:</span>
                  <p>Hệ thống tự động kiểm tra thẻ độc giả còn hạn, không bị khóa nợ quá ngưỡng (50.000đ với SV), và số sách đang mượn chưa đạt hạn mức tối đa (5 cuốn với SV, 10 cuốn với GV).</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="font-semibold text-foreground block">2. Tự Động Tính Tiền Phạt Trễ Hạn:</span>
                  <p>Khi nhận trả sách, Stored Procedure của MySQL sẽ tự động tính số ngày quá hạn và nhân với đơn giá phạt mỗi ngày đã ghi trong hợp đồng mượn (applied_daily_fee_vnd).</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="font-semibold text-foreground block">3. Tự Động Giải Phóng Cho Hàng Đợi Đặt Trước:</span>
                  <p>Nếu cuốn sách vừa trả đang có người khác xếp hàng đặt trước (waiting), bản sao sẽ tự động chuyển thành on_hold để ưu tiên cho độc giả đó thay vì trở về available.</p>
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CirculationDeskPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <CirculationDeskInner />
    </Suspense>
  );
}
