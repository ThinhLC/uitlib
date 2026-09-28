'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import {
  endpoints,
  type Me,
  type LoanItem,
  type Fine,
  type Reservation,
  type Reader,
  type Balance,
} from '@/lib/api/contract';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BookOpen,
  Calendar,
  AlertTriangle,
  RotateCw,
  Clock,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Loader2,
  LogIn,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

const READER_TYPE_LABELS: Record<string, string> = {
  STUDENT: 'Sinh viên',
  LECTURER: 'Giảng viên',
  EXTERNAL: 'Bạn đọc ngoài',
};

const FINE_TYPE_LABELS: Record<string, string> = {
  late: 'Quá hạn',
  damaged: 'Hư hỏng',
  lost: 'Báo mất',
};

const STATUS_LABELS: Record<string, string> = {
  on_loan: 'Đang mượn',
  returned: 'Đã trả',
  lost: 'Đã báo mất',
  waiting: 'Đang chờ',
  ready: 'Sẵn sàng lấy',
  fulfilled: 'Đã nhận sách',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn giữ',
};

export default function ReaderPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [readerDetail, setReaderDetail] = useState<Reader | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewingId, setRenewingId] = useState<number | null>(null);
  const [actionAlert, setActionAlert] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(async (meData) => {
        setMe(meData);
        if (meData.reader?.id) {
          const readerId = meData.reader.id;
          try {
            const [readerRes, balanceRes, loansRes, finesRes, resRes] = await Promise.all([
              apiFetch(endpoints.getReader, { params: { readerId } }, { token: session.access_token }),
              apiFetch(endpoints.readerBalance, { params: { readerId } }, { token: session.access_token }),
              apiFetch(endpoints.readerLoanItems, { params: { readerId } }, { token: session.access_token }),
              apiFetch(endpoints.readerFines, { params: { readerId } }, { token: session.access_token }),
              apiFetch(endpoints.readerReservations, { params: { readerId } }, { token: session.access_token }),
            ]);
            setReaderDetail(readerRes);
            setBalance(balanceRes);
            setLoans(loansRes.items);
            setFines(finesRes.items);
            setReservations(resRes.items);
          } catch (err) {
            console.error('Error fetching reader details', err);
          }
        }
      })
      .catch((err) => console.error('Failed to load me profile', err))
      .finally(() => setLoading(false));
  }, [session]);

  async function handleRenew(loanItemId: number) {
    if (!session) return;
    setRenewingId(loanItemId);
    setActionAlert(null);
    try {
      const res = await apiFetch(
        endpoints.renew,
        { params: { loanItemId } },
        { token: session.access_token }
      );
      setActionAlert({ ok: true, text: `Gia hạn sách thành công! Hạn trả mới: ${new Date(res.newDueAt).toLocaleDateString('vi-VN')}` });
      if (me?.reader?.id) {
        const refreshed = await apiFetch(
          endpoints.readerLoanItems,
          { params: { readerId: me.reader.id } },
          { token: session.access_token }
        );
        setLoans(refreshed.items);
      }
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? (err.body as any)?.message || err.message
          : 'Không thể gia hạn sách này (có thể đã hết lượt gia hạn hoặc sách có người đặt trước).';
      setActionAlert({ ok: false, text: msg });
    } finally {
      setRenewingId(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Đang tải thông tin bạn đọc...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <BookOpen className="mx-auto h-12 w-12 text-primary/40 mb-3" />
          <h2 className="text-xl font-bold">Yêu Cầu Đăng Nhập Bạn Đọc</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Vui lòng đăng nhập để xem danh sách sách đang mượn, gia hạn sách và kiểm tra các khoản phí phạt.
          </p>
          <Link href="/dev/auth" className="mt-6 block">
            <Button className="w-full gap-2">
              <LogIn className="h-4 w-4" />
              Đăng nhập bằng Email hoặc Google
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  const reader = readerDetail || me?.reader;
  const activeLoans = loans.filter((l) => l.status === 'on_loan');
  const overdueLoans = activeLoans.filter((l) => l.overdue);
  const totalDebt = balance?.outstandingVnd ?? 0;
  const activeCard = readerDetail?.activeCard;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header Profile Info */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {reader?.fullName || session.user.email}
            </h1>
            {reader && (
              <Badge variant="outline" className="text-xs uppercase font-mono">
                {READER_TYPE_LABELS[reader.readerType] || reader.readerType}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5" />
            Số thẻ thư viện: <span className="font-mono font-semibold">{activeCard?.cardNumber || 'Chưa cấp thẻ'}</span>
            {activeCard?.expiresAt && (
              <span>(Hạn dùng: {new Date(activeCard.expiresAt).toLocaleDateString('vi-VN')})</span>
            )}
          </p>
        </div>

        <Link href="/catalog">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <BookOpen className="h-3.5 w-3.5" />
            Khám phá thêm sách
          </Button>
        </Link>
      </div>

      {/* Action Notification Alert */}
      {actionAlert && (
        <div
          className={`mb-6 rounded-lg p-4 text-sm flex items-center gap-2 ${
            actionAlert.ok
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}
        >
          {actionAlert.ok ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{actionAlert.text}</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs">Sách Đang Mượn</CardDescription>
            <CardTitle className="text-2xl font-bold">{activeLoans.length}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            Cuốn sách bạn đang giữ
          </CardContent>
        </Card>

        <Card className={overdueLoans.length > 0 ? 'border-destructive/50 bg-destructive/5' : ''}>
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs">Sách Quá Hạn</CardDescription>
            <CardTitle className={`text-2xl font-bold ${overdueLoans.length > 0 ? 'text-destructive' : ''}`}>
              {overdueLoans.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            {overdueLoans.length > 0 ? 'Vui lòng trả sách sớm nhất' : 'Tất cả đều đúng hạn'}
          </CardContent>
        </Card>

        <Card className={totalDebt > 0 ? 'border-amber-500/50 bg-amber-500/5' : ''}>
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs">Tiền Phạt Chưa Nộp</CardDescription>
            <CardTitle className={`text-2xl font-bold ${totalDebt > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {totalDebt.toLocaleString('vi-VN')} đ
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            {totalDebt > 0 ? 'Cần nộp tại quầy thủ thư' : 'Không có nợ phạt'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs">Sách Đang Đặt Trước</CardDescription>
            <CardTitle className="text-2xl font-bold">{reservations.length}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            Đầu sách đang xếp hàng chờ
          </CardContent>
        </Card>
      </div>

      {/* Tabs Section */}
      <Tabs defaultValue="loans" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="loans">Sách Đang Mượn ({activeLoans.length})</TabsTrigger>
          <TabsTrigger value="history">Lịch Sử Mượn Trả ({loans.length})</TabsTrigger>
          <TabsTrigger value="reservations">Đặt Trước ({reservations.length})</TabsTrigger>
          <TabsTrigger value="fines">Khoản Phạt ({fines.length})</TabsTrigger>
        </TabsList>

        {/* Tab 1: Active Loans */}
        <TabsContent value="loans">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">Danh Sách Sách Đang Giữ</CardTitle>
              <CardDescription className="text-xs">
                Bạn có thể tự gia hạn sách trước ngày đáo hạn nếu sách chưa có người khác đặt trước.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {activeLoans.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Hiện bạn không mượn cuốn sách nào. Hãy khám phá kho sách để mượn tài liệu.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tên sách</TableHead>
                      <TableHead>Ngày mượn</TableHead>
                      <TableHead>Hạn trả</TableHead>
                      <TableHead>Số lần gia hạn</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeLoans.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <div>
                            <span>{item.book.title}</span>
                            {item.copy.barcode && (
                              <span className="block text-[11px] text-muted-foreground font-mono">
                                Mã vạch: {item.copy.barcode}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(item.borrowedAt).toLocaleDateString('vi-VN')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium">
                              {new Date(item.dueAt).toLocaleDateString('vi-VN')}
                            </span>
                            {item.overdue ? (
                              <Badge variant="destructive" className="text-[10px] py-0">
                                Quá hạn
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0 text-emerald-600 border-emerald-500/30">
                                Còn hạn
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {item.renewalCount} / {item.maxRenewals}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs h-7"
                            disabled={item.renewalCount >= item.maxRenewals || item.overdue || renewingId === item.id}
                            onClick={() => handleRenew(item.id)}
                          >
                            {renewingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                            Gia hạn
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Full History */}
        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên sách</TableHead>
                    <TableHead>Ngày mượn</TableHead>
                    <TableHead>Ngày trả</TableHead>
                    <TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-xs">{item.book.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.borrowedAt).toLocaleDateString('vi-VN')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.returnedAt ? new Date(item.returnedAt).toLocaleDateString('vi-VN') : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.status === 'on_loan'
                              ? 'default'
                              : item.status === 'returned'
                              ? 'secondary'
                              : 'destructive'
                          }
                          className="text-[10px]"
                        >
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Reservations */}
        <TabsContent value="reservations">
          <Card>
            <CardContent className="p-0">
              {reservations.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Bạn không có yêu cầu đặt trước nào đang chờ.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tên sách</TableHead>
                      <TableHead>Ngày yêu cầu</TableHead>
                      <TableHead>Vị trí hàng đợi</TableHead>
                      <TableHead>Tình trạng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((res) => (
                      <TableRow key={res.id}>
                        <TableCell className="font-medium text-xs">{res.book.title}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(res.requestedAt).toLocaleDateString('vi-VN')}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold">
                          #{res.queuePosition ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={res.status === 'ready' ? 'default' : 'outline'}
                            className="text-[10px]"
                          >
                            {STATUS_LABELS[res.status] || res.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Fines */}
        <TabsContent value="fines">
          <Card>
            <CardContent className="p-0">
              {fines.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Tuyệt vời! Bạn không có bất kỳ khoản tiền phạt nào chưa thanh toán.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lý do phạt</TableHead>
                      <TableHead>Số tiền phạt</TableHead>
                      <TableHead>Đã thanh toán</TableHead>
                      <TableHead>Còn phải nộp</TableHead>
                      <TableHead>Tình trạng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fines.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-xs font-medium">
                          {FINE_TYPE_LABELS[f.type] || f.type}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {f.assessedAmountVnd.toLocaleString('vi-VN')} đ
                        </TableCell>
                        <TableCell className="text-xs font-mono text-emerald-600">
                          {f.allocatedVnd.toLocaleString('vi-VN')} đ
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold text-destructive">
                          {f.remainingVnd.toLocaleString('vi-VN')} đ
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={f.remainingVnd === 0 ? 'secondary' : 'destructive'}
                            className="text-[10px]"
                          >
                            {f.remainingVnd === 0 ? 'Đã xong' : 'Chưa nộp'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
