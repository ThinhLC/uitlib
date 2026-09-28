'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import {
  endpoints,
  type Reader,
  type ReferenceType,
  type Me,
} from '@/lib/api/contract';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  Search,
  Plus,
  CreditCard,
  Mail,
  Phone,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  UserMinus,
  RefreshCw,
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
  inactive: { label: 'Ngưng sử dụng', variant: 'secondary' },
};

export default function ReadersListPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // Data state
  const [readers, setReaders] = useState<Reader[]>([]);
  const [totalReaders, setTotalReaders] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerTypes, setReaderTypes] = useState<ReferenceType[]>([]);

  // Dialog state for new reader
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newReaderType, setNewReaderType] = useState('STUDENT');

  // Check auth
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

  // Load user profile & reader types
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

  // Fetch readers
  const fetchReaders = useCallback(async () => {
    if (!session || !isStaff) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        endpoints.listReaders,
        {
          query: {
            page,
            pageSize,
            ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
            ...(selectedType !== 'ALL' ? { readerType: selectedType } : {}),
            ...(selectedStatus !== 'ALL' ? { status: selectedStatus as any } : {}),
          },
        },
        { token: session.access_token }
      );
      setReaders(res.items);
      setTotalReaders(res.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Không thể tải danh sách bạn đọc.');
      } else {
        setError('Lỗi kết nối máy chủ.');
      }
    } finally {
      setLoading(false);
    }
  }, [session, isStaff, page, searchQuery, selectedType, selectedStatus]);

  useEffect(() => {
    if (isStaff) {
      fetchReaders();
    }
  }, [fetchReaders, isStaff]);

  const handleCreateReader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!newFullName.trim()) {
      setCreateError('Vui lòng nhập họ và tên bạn đọc.');
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const created = await apiFetch(
        endpoints.createReader,
        {
          body: {
            fullName: newFullName.trim(),
            email: newEmail.trim() ? newEmail.trim() : null,
            phone: newPhone.trim() ? newPhone.trim() : null,
            readerType: newReaderType,
            status: 'active',
          },
        },
        { token: session.access_token }
      );
      setCreateSuccess(`Đã tạo bạn đọc ${created.fullName} thành công!`);
      setNewFullName('');
      setNewEmail('');
      setNewPhone('');
      fetchReaders();
      setTimeout(() => {
        setIsCreateOpen(false);
        setCreateSuccess(null);
        router.push(`/desk/readers/${created.id}`);
      }, 900);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message || 'Không thể tạo bạn đọc.');
      } else {
        setCreateError('Lỗi máy chủ khi tạo bạn đọc.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalReaders / pageSize));

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container max-w-xl mx-auto py-16 px-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 mb-4">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Yêu cầu đăng nhập</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Bạn cần đăng nhập với quyền Thủ thư hoặc Quản trị viên để quản lý hồ sơ bạn đọc.
        </p>
        <div className="mt-6">
          <Button render={<Link href="/dev/auth" />}>Đăng nhập ngay</Button>
        </div>
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="container max-w-xl mx-auto py-16 px-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <UserX className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Không có quyền truy cập</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Chỉ Thủ thư (Librarian) và Quản trị viên (Admin) mới có quyền truy cập trang Quản lý Bạn đọc.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" render={<Link href="/" />}>Trang chủ</Button>
          <Button render={<Link href="/reader" />}>Hồ sơ mượn của tôi</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-6 px-4 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Quản lý Bạn đọc</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Tra cứu thông tin, cấp thẻ thư viện, theo dõi mượn trả và công nợ của người đọc.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchReaders}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger render={<Button className="gap-1.5" />}>
              <Plus className="h-4 w-4" />
              Thêm bạn đọc mới
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleCreateReader}>
                <DialogHeader>
                  <DialogTitle>Thêm bạn đọc mới</DialogTitle>
                  <DialogDescription>
                    Nhập thông tin cơ bản để tạo hồ sơ bạn đọc trong hệ thống NexusLib.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  {createError && (
                    <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {createError}
                    </div>
                  )}
                  {createSuccess && (
                    <div className="p-3 text-xs rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {createSuccess}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Họ và tên <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="VD: Nguyễn Văn A"
                      value={newFullName}
                      onChange={(e) => setNewFullName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Đối tượng độc giả
                    </label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={newReaderType}
                      onChange={(e) => setNewReaderType(e.target.value)}
                    >
                      {readerTypes.length > 0 ? (
                        readerTypes.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name} ({t.code})
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="STUDENT">Sinh viên (STUDENT)</option>
                          <option value="LECTURER">Giảng viên (LECTURER)</option>
                          <option value="EXTERNAL">Bạn đọc ngoài (EXTERNAL)</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        Email liên hệ
                      </label>
                      <Input
                        type="email"
                        placeholder="nguyenvana@uit.edu.vn"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        Số điện thoại
                      </label>
                      <Input
                        type="tel"
                        placeholder="0901234567"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    disabled={createLoading}
                  >
                    Hủy
                  </Button>
                  <Button type="submit" disabled={createLoading}>
                    {createLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Đang lưu...
                      </>
                    ) : (
                      'Tạo bạn đọc'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid gap-3 sm:grid-cols-12 bg-muted/40 p-3 rounded-xl border">
        <div className="sm:col-span-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên, email, số điện thoại..."
            className="pl-9 bg-background"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="sm:col-span-3">
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Mọi đối tượng</option>
            <option value="STUDENT">Sinh viên</option>
            <option value="LECTURER">Giảng viên</option>
            <option value="EXTERNAL">Bạn đọc ngoài</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Mọi trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="suspended">Bị tạm khóa</option>
            <option value="inactive">Ngưng kích hoạt</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={fetchReaders}>
            Thử lại
          </Button>
        </div>
      )}

      {/* Readers List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Đang tải danh sách độc giả...</span>
        </div>
      ) : readers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
            <Users className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-lg">Không tìm thấy bạn đọc nào</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Không có kết quả khớp với điều kiện lọc hiện tại. Thử xóa bộ lọc hoặc thêm bạn đọc mới.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSearchQuery('');
              setSelectedType('ALL');
              setSelectedStatus('ALL');
              setPage(1);
            }}
          >
            Đặt lại bộ lọc
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {readers.map((reader) => {
            const statusConfig = STATUS_BADGES[reader.status] || {
              label: reader.status,
              variant: 'outline' as const,
            };
            const activeCard = reader.activeCard;

            return (
              <Card
                key={reader.id}
                className="group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/40"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold group-hover:text-primary transition-colors">
                        <Link href={`/desk/readers/${reader.id}`} className="hover:underline">
                          {reader.fullName}
                        </Link>
                      </CardTitle>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] py-0 font-medium">
                          {READER_TYPE_LABELS[reader.readerType] || reader.readerType}
                        </Badge>
                        <Badge variant={statusConfig.variant} className="text-[10px] py-0 font-medium">
                          {statusConfig.label}
                        </Badge>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      #{reader.id}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs text-muted-foreground">
                  <div className="space-y-1.5 border-t pt-2">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{reader.email || 'Chưa cập nhật email'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{reader.phone || 'Chưa có SĐT'}</span>
                    </div>
                  </div>

                  {/* Thẻ thư viện */}
                  <div className="rounded-lg bg-muted/60 p-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-primary" />
                      <div>
                        <div className="font-semibold text-foreground text-[11px]">
                          {activeCard ? activeCard.cardNumber : 'Chưa có thẻ kích hoạt'}
                        </div>
                        <div className="text-[10px]">
                          {activeCard
                            ? `Hết hạn: ${new Date(activeCard.expiresAt).toLocaleDateString('vi-VN')}`
                            : 'Cần cấp thẻ để mượn sách'}
                        </div>
                      </div>
                    </div>

                    {activeCard ? (
                      <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                        Hợp lệ
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-500/30">
                        Chưa cấp
                      </Badge>
                    )}
                  </div>

                  {/* Thao tác */}
                  <div className="flex items-center justify-between pt-1">
                    {activeCard ? (
                      <Button
                        size="xs"
                        variant="outline"
                        render={<Link href={`/desk?cardNumber=${activeCard.cardNumber}`} />}
                        className="text-[11px] h-7 gap-1"
                      >
                        <CreditCard className="h-3 w-3" />
                        Mở quầy mượn
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">
                        Cần cấp thẻ để mượn
                      </span>
                    )}

                    <Button
                      size="xs"
                      render={<Link href={`/desk/readers/${reader.id}`} />}
                      className="text-[11px] h-7 gap-1 ml-auto"
                    >
                      Chi tiết
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
          <div>
            Hiển thị trang <span className="font-medium text-foreground">{page}</span> /{' '}
            <span className="font-medium text-foreground">{totalPages}</span> (Tổng cộng{' '}
            <span className="font-medium text-foreground">{totalReaders}</span> bạn đọc)
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Trước
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="gap-1"
            >
              Sau
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
