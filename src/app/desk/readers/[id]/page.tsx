'use client';

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import {
  endpoints,
  type Reader,
  type Card as LibraryCard,
  type LoanItem,
  type Fine,
  type Balance,
  type ReferenceType,
  type Me,
} from '@/lib/api/contract';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Users,
  CreditCard,
  BookOpen,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Ban,
  Plus,
  RefreshCw,
  Clock,
  Check,
  ChevronRight,
  ExternalLink,
  Edit,
  UserX,
  RotateCcw,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

const READER_TYPE_LABELS: Record<string, string> = {
  STUDENT: 'Sinh viên',
  LECTURER: 'Giảng viên',
  EXTERNAL: 'Bạn đọc ngoài',
};

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }> = {
  active: { label: 'Đang hoạt động', variant: 'default' },
  suspended: { label: 'Bị tạm khóa', variant: 'destructive' },
  inactive: { label: 'Ngưng kích hoạt', variant: 'secondary' },
};

const CARD_STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }> = {
  active: { label: 'Đang hiệu lực', variant: 'default' },
  expired: { label: 'Hết hạn', variant: 'outline' },
  lost: { label: 'Báo mất', variant: 'destructive' },
  revoked: { label: 'Thu hồi', variant: 'secondary' },
};

const FINE_TYPE_LABELS: Record<string, string> = {
  late: 'Trả quá hạn',
  damaged: 'Hư hỏng tài liệu',
  lost: 'Báo mất sách',
};

export default function ReaderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const readerId = Number(id);
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Reader detail states
  const [reader, setReader] = useState<Reader | null>(null);
  const [cards, setCards] = useState<LibraryCard[]>([]);
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [readerTypes, setReaderTypes] = useState<ReferenceType[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal: Edit Reader
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStatus, setEditStatus] = useState<string>('active');
  const [editType, setEditType] = useState<string>('STUDENT');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Modal: Issue New Card
  const [isIssueCardOpen, setIsIssueCardOpen] = useState(false);
  const [newCardNumber, setNewCardNumber] = useState('');
  const [newCardExpiry, setNewCardExpiry] = useState('');
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // Card status change
  const [actionCardId, setActionCardId] = useState<number | null>(null);
  const [cardActionLoading, setCardActionLoading] = useState(false);

  // Return book directly from active loan item
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedLoanItem, setSelectedLoanItem] = useState<LoanItem | null>(null);
  const [returnCondition, setReturnCondition] = useState<'good' | 'worn' | 'damaged'>('good');
  const [damageFee, setDamageFee] = useState<number>(0);
  const [damageReason, setDamageReason] = useState<string>('');
  const [returnProcessing, setReturnProcessing] = useState(false);
  const [returnFeedback, setReturnFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  // Renew book directly
  const [renewLoadingId, setRenewLoadingId] = useState<number | null>(null);
  const [loanFeedback, setLoanFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  // Auth setup
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
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

    apiFetch(endpoints.readerTypes, {}, { token: session.access_token })
      .then((res) => setReaderTypes(res.items))
      .catch(() => {});
  }, [session]);

  const isStaff = useMemo(() => {
    const roles = me?.roles ?? [];
    return roles.includes('librarian') || roles.includes('admin');
  }, [me]);

  // Load Reader Data
  const loadData = useCallback(async () => {
    if (!session || !isStaff || !readerId) return;
    setLoading(true);
    setError(null);
    try {
      const [rData, cardsData, loansData, balanceData, finesData] = await Promise.all([
        apiFetch(endpoints.getReader, { params: { readerId } }, { token: session.access_token }),
        apiFetch(endpoints.readerCards, { params: { readerId } }, { token: session.access_token }),
        apiFetch(endpoints.readerLoanItems, { params: { readerId }, query: { pageSize: 50 } }, { token: session.access_token }).catch(() => ({ items: [], total: 0 })),
        apiFetch(endpoints.readerBalance, { params: { readerId } }, { token: session.access_token }).catch(() => null),
        apiFetch(endpoints.readerFines, { params: { readerId }, query: { pageSize: 50 } }, { token: session.access_token }).catch(() => ({ items: [], total: 0 })),
      ]);

      setReader(rData);
      setCards(cardsData.items);
      setLoans(loansData.items);
      setBalance(balanceData);
      setFines(finesData.items);

      // Pre-fill edit modal
      setEditFullName(rData.fullName);
      setEditEmail(rData.email || '');
      setEditPhone(rData.phone || '');
      setEditStatus(rData.status);
      setEditType(rData.readerType);

      // Default next year expiry for new card
      const oneYearLater = new Date();
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      setNewCardExpiry(oneYearLater.toISOString().split('T')[0]);
      setNewCardNumber(`C2026-${String(readerId).padStart(4, '0')}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Không tìm thấy hồ sơ bạn đọc.');
      } else {
        setError('Lỗi khi tải dữ liệu bạn đọc.');
      }
    } finally {
      setLoading(false);
    }
  }, [session, isStaff, readerId]);

  useEffect(() => {
    if (isStaff && readerId) {
      loadData();
    }
  }, [loadData, isStaff, readerId]);

  // Edit Reader Info
  const handleUpdateReader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !reader) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const updated = await apiFetch(
        endpoints.updateReader,
        {
          params: { readerId: reader.id },
          body: {
            fullName: editFullName.trim(),
            email: editEmail.trim() ? editEmail.trim() : null,
            phone: editPhone.trim() ? editPhone.trim() : null,
            status: editStatus as any,
            readerType: editType,
          },
        },
        { token: session.access_token }
      );
      setReader(updated);
      setIsEditOpen(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditError(err.message || 'Không thể cập nhật hồ sơ bạn đọc.');
      } else {
        setEditError('Lỗi máy chủ khi cập nhật.');
      }
    } finally {
      setEditLoading(false);
    }
  };

  // Issue Card
  const handleIssueCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !reader) return;
    setIssueLoading(true);
    setIssueError(null);
    try {
      const expDate = new Date(`${newCardExpiry}T23:59:59.000Z`);
      await apiFetch(
        endpoints.issueCard,
        {
          params: { readerId: reader.id },
          body: {
            cardNumber: newCardNumber.trim(),
            expiresAt: expDate.toISOString(),
          },
        },
        { token: session.access_token }
      );
      setIsIssueCardOpen(false);
      loadData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setIssueError(err.message || 'Không thể cấp thẻ mới.');
      } else {
        setIssueError('Lỗi máy chủ khi cấp thẻ.');
      }
    } finally {
      setIssueLoading(false);
    }
  };

  // Set Card Status (lost, revoked, expired)
  const handleSetCardStatus = async (cardId: number, status: 'lost' | 'revoked' | 'expired') => {
    if (!session) return;
    setActionCardId(cardId);
    try {
      await apiFetch(
        endpoints.setCardStatus,
        {
          params: { cardId },
          body: { status },
        },
        { token: session.access_token }
      );
      loadData();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Không thể thay đổi trạng thái thẻ.');
    } finally {
      setActionCardId(null);
    }
  };

  // Open Return Dialog directly for a borrowed book
  const openReturnModal = (item: LoanItem) => {
    setSelectedLoanItem(item);
    setReturnCondition('good');
    setDamageFee(0);
    setDamageReason('');
    setReturnFeedback(null);
    setReturnDialogOpen(true);
  };

  // Process 1-click return via sp_return_item
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !selectedLoanItem) return;
    setReturnProcessing(true);
    setReturnFeedback(null);
    try {
      const res = await apiFetch(
        endpoints.returnItem,
        {
          params: { loanItemId: selectedLoanItem.id },
          body: {
            condition: returnCondition,
            damagedFineVnd: returnCondition === 'damaged' && damageFee > 0 ? damageFee : undefined,
            reason: returnCondition === 'damaged' ? (damageReason.trim() || 'Hư hỏng khi trả') : undefined,
          },
        },
        { token: session.access_token }
      );

      const fineNotice = res.fines && res.fines.length > 0
        ? ` (Phát sinh phạt: ${res.fines.map((f) => `${f.amountVnd.toLocaleString('vi-VN')} đ`).join(', ')})`
        : '';

      setReturnFeedback({
        ok: true,
        message: `Đã nhận trả thành công ấn phẩm "${selectedLoanItem.book.title}"!${fineNotice}`,
      });
      loadData();
      setTimeout(() => {
        setReturnDialogOpen(false);
        setReturnFeedback(null);
      }, 1000);
    } catch (err) {
      setReturnFeedback({
        ok: false,
        message: err instanceof ApiClientError ? (err.body as any)?.message || err.message : 'Không thể thực hiện trả sách.',
      });
    } finally {
      setReturnProcessing(false);
    }
  };

  // Process renew directly via sp_renew
  const handleRenewLoan = async (item: LoanItem) => {
    if (!session) return;
    setRenewLoadingId(item.id);
    setLoanFeedback(null);
    try {
      const res = await apiFetch(
        endpoints.renew,
        {
          params: { loanItemId: item.id },
        },
        { token: session.access_token }
      );
      setLoanFeedback({
        ok: true,
        message: `Đã gia hạn thành công cuốn "${item.book.title}" đến ngày ${new Date(res.newDueAt).toLocaleDateString('vi-VN')}!`,
      });
      loadData();
    } catch (err) {
      setLoanFeedback({
        ok: false,
        message: err instanceof ApiClientError ? (err.body as any)?.message || err.message : 'Gia hạn không thành công.',
      });
    } finally {
      setRenewLoadingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session || !isStaff) {
    return (
      <div className="container max-w-xl mx-auto py-16 px-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <UserX className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Quyền truy cập hạn chế</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Chỉ Thủ thư hoặc Quản trị viên mới được xem chi tiết hồ sơ độc giả.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" render={<Link href="/" />}>Trang chủ</Button>
          <Button render={<Link href="/dev/auth" />}>Đăng nhập Dev</Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span>Đang tải hồ sơ bạn đọc #{readerId}...</span>
      </div>
    );
  }

  if (error || !reader) {
    return (
      <div className="container max-w-xl mx-auto py-16 px-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Không tìm thấy bạn đọc</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error || 'Hồ sơ không tồn tại.'}</p>
        <div className="mt-6">
          <Button variant="outline" render={<Link href="/desk/readers" />}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Về danh sách bạn đọc
          </Button>
        </div>
      </div>
    );
  }

  const activeCard = reader.activeCard;
  const activeLoans = loans.filter((l) => l.status === 'on_loan');
  const pastLoans = loans.filter((l) => l.status !== 'on_loan');
  const totalDebt = balance?.outstandingVnd ?? 0;

  return (
    <div className="container mx-auto max-w-6xl py-6 px-4 space-y-6">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/desk/readers"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách bạn đọc
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Làm mới
          </Button>
        </div>
      </div>

      {/* Main Profile Header Card */}
      <Card className="overflow-hidden border shadow-sm">
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-2xl shadow-sm">
                {reader.fullName[0]?.toUpperCase() || 'U'}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight">{reader.fullName}</h1>
                  <Badge variant={STATUS_BADGES[reader.status]?.variant || 'outline'}>
                    {STATUS_BADGES[reader.status]?.label || reader.status}
                  </Badge>
                  <Badge variant="outline">
                    {READER_TYPE_LABELS[reader.readerType] || reader.readerType}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span className="font-mono">Mã hồ sơ: #{reader.id}</span>
                  <span>•</span>
                  <span>
                    Tạo ngày: {new Date(reader.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
                  <Edit className="h-4 w-4" />
                  Sửa thông tin
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleUpdateReader}>
                    <DialogHeader>
                      <DialogTitle>Sửa thông tin bạn đọc</DialogTitle>
                      <DialogDescription>
                        Cập nhật họ tên, liên hệ, loại đối tượng và trạng thái hoạt động.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                      {editError && (
                        <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {editError}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Họ và tên</label>
                        <Input
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold">Đối tượng độc giả</label>
                          <select
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                          >
                            <option value="STUDENT">Sinh viên</option>
                            <option value="LECTURER">Giảng viên</option>
                            <option value="EXTERNAL">Bạn đọc ngoài</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold">Trạng thái hồ sơ</label>
                          <select
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                          >
                            <option value="active">Đang hoạt động</option>
                            <option value="suspended">Bị tạm khóa</option>
                            <option value="inactive">Ngưng kích hoạt</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold">Email</label>
                          <Input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold">Số điện thoại</label>
                          <Input
                            type="tel"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsEditOpen(false)}
                        disabled={editLoading}
                      >
                        Hủy
                      </Button>
                      <Button type="submit" disabled={editLoading}>
                        {editLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {activeCard && (
                <Button
                  render={<Link href={`/desk?cardNumber=${activeCard.cardNumber}`} />}
                  className="gap-1.5"
                >
                  <CreditCard className="h-4 w-4" />
                  Mở quầy mượn trả
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x border-b bg-card">
          <div className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
            </span>
            <p className="text-sm font-medium truncate">
              {reader.email || <span className="text-muted-foreground italic">Chưa có</span>}
            </p>
          </div>

          <div className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> Điện thoại
            </span>
            <p className="text-sm font-medium">
              {reader.phone || <span className="text-muted-foreground italic">Chưa có</span>}
            </p>
          </div>

          <div className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Sách đang mượn
            </span>
            <p className="text-sm font-semibold text-foreground">
              {activeLoans.length} cuốn
            </p>
          </div>

          <div className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Công nợ / Tiền phạt
            </span>
            <p className={`text-sm font-semibold ${totalDebt > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
              {totalDebt.toLocaleString('vi-VN')} đ
            </p>
          </div>
        </div>
      </Card>

      {/* Tabs Layout */}
      <Tabs defaultValue="loans" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="loans" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Lưu thông ({activeLoans.length})
          </TabsTrigger>
          <TabsTrigger value="cards" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Thẻ thư viện ({cards.length})
          </TabsTrigger>
          <TabsTrigger value="fines" className="gap-2">
            <DollarSign className="h-4 w-4" />
            Tiền phạt ({fines.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Circulation / Loans */}
        <TabsContent value="loans" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Sách đang mượn hiện tại</CardTitle>
                <CardDescription>Các tài liệu độc giả chưa trả</CardDescription>
              </div>
              {activeCard && (
                <Button size="sm" variant="outline" render={<Link href={`/desk?cardNumber=${activeCard.cardNumber}`} />}>
                  Gia hạn / Trả sách tại Desk
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {loanFeedback && (
                <div
                  className={`p-3 text-xs rounded-md border flex items-center justify-between gap-2 ${
                    loanFeedback.ok
                      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                      : 'bg-destructive/10 text-destructive border-destructive/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {loanFeedback.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span>{loanFeedback.message}</span>
                  </div>
                  <button
                    onClick={() => setLoanFeedback(null)}
                    className="text-xs hover:underline font-medium"
                  >
                    Đóng
                  </button>
                </div>
              )}

              {activeLoans.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Hiện bạn đọc không mượn cuốn sách nào.
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {activeLoans.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-semibold text-sm text-foreground">
                          {item.book.title}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            Mã vạch: {item.copy.barcode || 'N/A'}
                          </Badge>
                          <span>•</span>
                          <span>
                            Mượn: {new Date(item.borrowedAt).toLocaleDateString('vi-VN')}
                          </span>
                          <span>•</span>
                          <span className={item.overdue ? 'text-destructive font-bold' : ''}>
                            Hạn trả: {new Date(item.dueAt).toLocaleDateString('vi-VN')}
                          </span>
                          <span>•</span>
                          <Badge variant="secondary" className="text-[10px]">
                            Gia hạn {item.renewalCount}/{item.maxRenewals} lần
                          </Badge>
                          {item.overdue && (
                            <Badge variant="destructive" className="text-[10px]">
                              Quá hạn
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Nút hành động trực tiếp: Gia hạn & Trả sách không cần nhập mã */}
                      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            item.overdue ||
                            item.renewalCount >= item.maxRenewals ||
                            renewLoadingId === item.id
                          }
                          onClick={() => handleRenewLoan(item)}
                          className="text-xs h-7 gap-1"
                          title={
                            item.overdue
                              ? 'Sách quá hạn không thể gia hạn'
                              : item.renewalCount >= item.maxRenewals
                              ? 'Đã đạt số lần gia hạn tối đa'
                              : 'Gia hạn thêm thời gian mượn'
                          }
                        >
                          {renewLoadingId === item.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          Gia hạn
                        </Button>

                        <Button
                          size="xs"
                          onClick={() => openReturnModal(item)}
                          className="text-xs h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Trả sách này
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dialog Xác nhận Trả sách trực tiếp (Không cần gõ mã) */}
          <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleConfirmReturn}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <RotateCcw className="h-5 w-5 text-emerald-600" />
                    Nhận trả sách (Không cần nhập mã vạch)
                  </DialogTitle>
                  <DialogDescription>
                    Thủ tục trả ấn phẩm trực tiếp từ danh sách mượn của bạn đọc.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4 text-xs">
                  {returnFeedback && (
                    <div
                      className={`p-3 rounded-md border flex items-center gap-2 ${
                        returnFeedback.ok
                          ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                          : 'bg-destructive/10 text-destructive border-destructive/30'
                      }`}
                    >
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {returnFeedback.message}
                    </div>
                  )}

                  {selectedLoanItem && (
                    <div className="rounded-lg bg-muted/60 p-3 space-y-1.5 border">
                      <div className="font-semibold text-sm text-foreground">
                        {selectedLoanItem.book.title}
                      </div>
                      <div className="text-muted-foreground flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="font-mono">
                          Mã vạch: {selectedLoanItem.copy.barcode || 'N/A'}
                        </span>
                        <span>•</span>
                        <span
                          className={selectedLoanItem.overdue ? 'text-destructive font-bold' : ''}
                        >
                          Hạn trả: {new Date(selectedLoanItem.dueAt).toLocaleDateString('vi-VN')}
                          {selectedLoanItem.overdue ? ' (Đã quá hạn)' : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">
                      Tình trạng sách khi nhận lại:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'good', label: 'Nguyên vẹn', desc: 'Tốt' },
                        { id: 'worn', label: 'Hơi cũ', desc: 'Bình thường' },
                        { id: 'damaged', label: 'Hư hỏng', desc: 'Rách/Mất trang' },
                      ].map((cond) => (
                        <button
                          key={cond.id}
                          type="button"
                          onClick={() => setReturnCondition(cond.id as any)}
                          className={`p-2.5 rounded-lg border text-left transition-all ${
                            returnCondition === cond.id
                              ? 'border-primary bg-primary/10 text-primary font-semibold'
                              : 'border-border bg-background hover:bg-muted/50'
                          }`}
                        >
                          <div className="font-medium">{cond.label}</div>
                          <div className="text-[10px] text-muted-foreground">{cond.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {returnCondition === 'damaged' && (
                    <div className="space-y-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                      <div className="space-y-1.5">
                        <label className="font-semibold text-destructive">
                          Tiền phạt hư hỏng (VNĐ):
                        </label>
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          placeholder="Ví dụ: 50000"
                          value={damageFee || ''}
                          onChange={(e) => setDamageFee(Number(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="font-semibold text-destructive">
                          Lý do hư hỏng:
                        </label>
                        <Input
                          placeholder="Ví dụ: Rách bìa, vẽ bậy vào trang 45-50..."
                          value={damageReason}
                          onChange={(e) => setDamageReason(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReturnDialogOpen(false)}
                    disabled={returnProcessing}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    disabled={returnProcessing}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {returnProcessing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Đang xử lý trả...
                      </>
                    ) : (
                      'Xác nhận nhận trả sách'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Past Loans History */}
          {pastLoans.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Lịch sử mượn trước đây</CardTitle>
                <CardDescription>Các cuốn sách đã trả hoặc báo mất</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y rounded-md border text-xs">
                  {pastLoans.slice(0, 10).map((item) => (
                    <div key={item.id} className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-foreground">{item.book.title}</div>
                        <div className="text-muted-foreground text-[11px]">
                          Mượn {new Date(item.borrowedAt).toLocaleDateString('vi-VN')} · Đã trả{' '}
                          {item.returnedAt ? new Date(item.returnedAt).toLocaleDateString('vi-VN') : '---'}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {item.status === 'returned' ? 'Đã trả' : item.status === 'lost' ? 'Đã báo mất' : item.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 2: Library Cards */}
        <TabsContent value="cards" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Thẻ thư viện</CardTitle>
                <CardDescription>
                  Quản lý thẻ thư viện, cấp thẻ mới hoặc báo mất / thu hồi thẻ.
                </CardDescription>
              </div>

              <Dialog open={isIssueCardOpen} onOpenChange={setIsIssueCardOpen}>
                <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
                  <Plus className="h-4 w-4" />
                  Cấp thẻ mới
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleIssueCard}>
                    <DialogHeader>
                      <DialogTitle>Cấp thẻ thư viện mới</DialogTitle>
                      <DialogDescription>
                        Thủ tục cấp thẻ thông qua stored procedure <code className="font-mono text-primary">sp_issue_card</code>.
                        Nếu bạn đọc đã có thẻ active, hệ thống sẽ yêu cầu vô hiệu hóa thẻ cũ trước.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                      {issueError && (
                        <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {issueError}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Số thẻ (Barcode/Card Number)</label>
                        <Input
                          placeholder="VD: C2026-0001"
                          value={newCardNumber}
                          onChange={(e) => setNewCardNumber(e.target.value)}
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold">Ngày hết hạn thẻ</label>
                        <Input
                          type="date"
                          value={newCardExpiry}
                          onChange={(e) => setNewCardExpiry(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsIssueCardOpen(false)}
                        disabled={issueLoading}
                      >
                        Hủy
                      </Button>
                      <Button type="submit" disabled={issueLoading}>
                        {issueLoading ? 'Đang cấp thẻ...' : 'Xác nhận cấp thẻ'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>

            <CardContent>
              {cards.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Bạn đọc chưa được cấp thẻ thư viện nào. Nhấn "Cấp thẻ mới" ở trên để tạo thẻ.
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {cards.map((card) => {
                    const statusConfig = CARD_STATUS_BADGES[card.status] || {
                      label: card.status,
                      variant: 'outline' as const,
                    };
                    const isActive = card.status === 'active';

                    return (
                      <div key={card.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            <CreditCard className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-foreground">
                                {card.cardNumber}
                              </span>
                              <Badge variant={statusConfig.variant} className="text-[10px]">
                                {statusConfig.label}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground mt-0.5 text-[11px]">
                              Cấp ngày: {new Date(card.issuedAt).toLocaleDateString('vi-VN')} · Hết hạn:{' '}
                              {new Date(card.expiresAt).toLocaleDateString('vi-VN')}
                            </div>
                          </div>
                        </div>

                        {isActive && (
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <Button
                              size="xs"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10"
                              disabled={cardActionLoading && actionCardId === card.id}
                              onClick={() => {
                                if (confirm(`Bạn có chắc muốn báo mất thẻ ${card.cardNumber}?`)) {
                                  handleSetCardStatus(card.id, 'lost');
                                }
                              }}
                            >
                              Báo mất
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              className="text-muted-foreground"
                              disabled={cardActionLoading && actionCardId === card.id}
                              onClick={() => {
                                if (confirm(`Bạn có chắc muốn thu hồi thẻ ${card.cardNumber}?`)) {
                                  handleSetCardStatus(card.id, 'revoked');
                                }
                              }}
                            >
                              Thu hồi
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Fines & Balance */}
        <TabsContent value="fines" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Công nợ & Tiền phạt</CardTitle>
                  <CardDescription>Tổng hợp các khoản phạt trả trễ hoặc hư hỏng tài liệu</CardDescription>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">Còn nợ:</span>
                  <div className={`text-lg font-bold ${totalDebt > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {totalDebt.toLocaleString('vi-VN')} đ
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {fines.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Bạn đọc không có khoản phạt nào.
                </div>
              ) : (
                <div className="divide-y rounded-md border text-xs">
                  {fines.map((f) => (
                    <div key={f.id} className="p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">{f.book.title}</div>
                        <div className="text-muted-foreground text-[11px] mt-0.5">
                          Loại phạt: {FINE_TYPE_LABELS[f.type] || f.type} · Ngày:{' '}
                          {new Date(f.assessedAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-destructive">
                          {f.remainingVnd.toLocaleString('vi-VN')} đ
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Gốc: {f.assessedAmountVnd.toLocaleString('vi-VN')} đ
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
