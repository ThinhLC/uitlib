'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  Clock,
  BookMarked,
  BarChart,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  Database,
  Lock,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch } from '@/lib/api/client';
import {
  endpoints,
  type InvariantHealth,
  type RollforwardReport,
  type OverdueRow,
  type PopularBookRow,
  type CopyStatusRow,
} from '@/lib/api/contract';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import type { Session } from '@supabase/supabase-js';

export default function AdminReportsPage() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Data states
  const [health, setHealth] = React.useState<InvariantHealth | null>(null);
  const [rollforward, setRollforward] = React.useState<RollforwardReport | null>(null);
  const [overdues, setOverdues] = React.useState<OverdueRow[]>([]);
  const [popular, setPopular] = React.useState<PopularBookRow[]>([]);
  const [copyStatus, setCopyStatus] = React.useState<CopyStatusRow[]>([]);

  // Rollforward month query
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = React.useState(currentMonth);

  const [activeTab, setActiveTab] = React.useState('health');
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const loadData = React.useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    setErrorMsg(null);
    const token = session.access_token;

    try {
      if (activeTab === 'health') {
        const res = await apiFetch(endpoints.adminHealth, {}, { token });
        setHealth(res);
      } else if (activeTab === 'rollforward') {
        const res = await apiFetch(
          endpoints.reportRollforward,
          { query: { month: selectedMonth } },
          { token }
        );
        setRollforward(res);
      } else if (activeTab === 'overdue') {
        const res = await apiFetch(
          endpoints.reportOverdue,
          { query: { page: 1, pageSize: 50 } },
          { token }
        );
        setOverdues(res.items);
      } else if (activeTab === 'analytics') {
        const [popRes, statusRes] = await Promise.all([
          apiFetch(endpoints.reportPopularBooks, { query: { limit: 10 } }, { token }),
          apiFetch(endpoints.reportCopyStatus, { query: { page: 1, pageSize: 20 } }, { token }),
        ]);
        setPopular(popRes.items);
        setCopyStatus(statusRes.items);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải báo cáo. Hãy kiểm tra quyền hạn.';
      setErrorMsg(msg);
    } finally {
      setRefreshing(false);
    }
  }, [session, activeTab, selectedMonth]);

  React.useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session, activeTab, loadData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <Card className="max-w-xl mx-auto my-12 border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
            <Lock className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg">Yêu Cầu Quyền Quản Trị Hệ Thống</CardTitle>
          <CardDescription className="text-xs">
            Trang báo cáo & kiểm toán CSDL yêu cầu tài khoản có quyền Quản trị viên (Admin) hoặc Thủ thư (Librarian).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-6">
          <Link href="/dev/auth">
            <Button className="gap-2 text-xs">
              Đăng nhập với vai trò Admin (Dev Auth)
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner / Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Báo Cáo & Kiểm Toán CSDL</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Kiểm tra toàn vẹn hệ thống (Invariants), kiểm toán dòng tiền phạt và giám sát mượn trả tài liệu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={refreshing}
            className="gap-2 text-xs h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Tabs navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 max-w-2xl">
          <TabsTrigger value="health" className="gap-2 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Toàn vẹn (Invariants)
          </TabsTrigger>
          <TabsTrigger value="rollforward" className="gap-2 text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Kiểm toán nợ phạt
          </TabsTrigger>
          <TabsTrigger value="overdue" className="gap-2 text-xs">
            <Clock className="h-3.5 w-3.5" />
            Quá hạn lưu thông
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2 text-xs">
            <BarChart className="h-3.5 w-3.5" />
            Thống kê ấn phẩm
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Invariant Health */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    Kiểm Tra Bất Biến Toàn Vẹn CSDL (v_inv_*)
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Mỗi view bất biến truy vấn trạng thái dữ liệu hợp lệ. Nếu không có dòng vi phạm, hệ thống hoàn toàn toàn vẹn.
                  </CardDescription>
                </div>
                {health && (
                  <Badge
                    variant={health.violations.length === 0 ? 'secondary' : 'destructive'}
                    className="text-xs"
                  >
                    {health.violations.length === 0
                      ? '✓ 100% Bất biến Đạt Chuẩn'
                      : `⚠ Có ${health.violations.length} vi phạm`}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {health ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {health.views.map((viewName) => {
                      const violation = health.violations.find((v) => v.view === viewName);
                      const isOk = !violation || violation.rows.length === 0;
                      return (
                        <div
                          key={viewName}
                          className={`rounded-lg border p-3 flex items-start justify-between gap-2 ${
                            isOk
                              ? 'border-emerald-500/20 bg-emerald-500/5'
                              : 'border-destructive/30 bg-destructive/5'
                          }`}
                        >
                          <div className="space-y-1">
                            <span className="font-mono text-xs font-semibold block">{viewName}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {isOk ? 'Không có vi phạm nào' : `Phát hiện ${violation?.rows.length} bản ghi vi phạm`}
                            </span>
                          </div>
                          {isOk ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {health.violations.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <h4 className="text-sm font-bold text-destructive">Chi tiết các bản ghi vi phạm:</h4>
                      {health.violations.map((v) => (
                        <Card key={v.view} className="border-destructive/30">
                          <CardHeader className="py-2.5 px-4 bg-destructive/10">
                            <CardTitle className="text-xs font-mono text-destructive">{v.view}</CardTitle>
                          </CardHeader>
                          <CardContent className="p-0 overflow-x-auto">
                            <pre className="p-3 text-[11px] font-mono leading-relaxed">
                              {JSON.stringify(v.rows, null, 2)}
                            </pre>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">Đang tải trạng thái bất biến...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Rollforward Debt Audit */}
        <TabsContent value="rollforward" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    Bảng Luân Chuyển Nợ Phạt Tháng (Debt Rollforward)
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Công thức kiểm toán: <code>Nợ cuối kỳ = Nợ đầu kỳ + Phạt phát sinh + Điều chỉnh - Đã thu</code>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Tháng kiểm toán:</span>
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-36 h-8 text-xs font-mono"
                  />
                  <Button size="sm" variant="secondary" onClick={loadData} className="h-8 text-xs">
                    Tra cứu
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rollforward ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-24 text-xs font-semibold">Mã bạn đọc</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Nợ đầu kỳ</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Phạt phát sinh</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Điều chỉnh</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Đã thu trong kỳ</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Nợ cuối kỳ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rollforward.rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                            Không có biến động công nợ trong tháng {selectedMonth}.
                          </TableCell>
                        </TableRow>
                      ) : (
                        rollforward.rows.map((row) => (
                          <TableRow key={row.readerId} className="font-mono text-xs">
                            <TableCell className="font-semibold text-foreground">#{row.readerId}</TableCell>
                            <TableCell className="text-right">{row.openingOutstandingVnd.toLocaleString('vi-VN')} đ</TableCell>
                            <TableCell className="text-right text-amber-600">+{row.assessedInPeriodVnd.toLocaleString('vi-VN')} đ</TableCell>
                            <TableCell className="text-right text-blue-600">{row.adjustedInPeriodVnd.toLocaleString('vi-VN')} đ</TableCell>
                            <TableCell className="text-right text-emerald-600">-{row.collectedInPeriodVnd.toLocaleString('vi-VN')} đ</TableCell>
                            <TableCell className="text-right font-bold text-destructive">
                              {row.closingOutstandingVnd.toLocaleString('vi-VN')} đ
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">Đang tải dữ liệu kiểm toán...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Overdue Loans */}
        <TabsContent value="overdue" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                Danh Sách Sách Mượn Quá Hạn
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Các ấn phẩm chưa được trả đúng hạn quy định, được sắp xếp theo thời gian trễ nhiều nhất.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="text-xs font-semibold">Tên bạn đọc</TableHead>
                      <TableHead className="text-xs font-semibold">Tên tài liệu</TableHead>
                      <TableHead className="text-xs font-semibold">Mã vạch</TableHead>
                      <TableHead className="text-xs font-semibold">Hạn trả ban đầu</TableHead>
                      <TableHead className="text-right text-xs font-semibold">Số ngày quá hạn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overdues.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                          🎉 Tuyệt vời! Hiện tại không có ấn phẩm nào bị mượn quá hạn.
                        </TableCell>
                      </TableRow>
                    ) : (
                      overdues.map((item) => (
                        <TableRow key={item.loanItemId} className="text-xs">
                          <TableCell className="font-medium">
                            {item.fullName}
                            <span className="block text-[10px] text-muted-foreground font-mono">
                              Mã #{item.readerId}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-medium">{item.title}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{item.barcode}</TableCell>
                          <TableCell className="text-muted-foreground font-mono">
                            {new Date(item.dueAt).toLocaleDateString('vi-VN')}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="destructive" className="font-mono text-[11px]">
                              {item.daysLate} ngày
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Popular & Copy status */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Borrowed Books */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Top 10 Sách Được Mượn Nhiều Nhất
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Thống kê các đầu sách có tần suất mượn cao nhất trong thư viện.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-12 text-xs font-semibold">#</TableHead>
                        <TableHead className="text-xs font-semibold">Tên sách</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Số lượt mượn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {popular.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6 text-xs text-muted-foreground">
                            Chưa có dữ liệu thống kê.
                          </TableCell>
                        </TableRow>
                      ) : (
                        popular.map((book, idx) => (
                          <TableRow key={book.bookId} className="text-xs">
                            <TableCell className="font-bold font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{book.title}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              <Badge variant="secondary">{book.loanItems} lượt</Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Copies by Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookMarked className="h-4 w-4 text-emerald-600" />
                  Trạng Thái Bản Sao Trên Giá
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Chi tiết bản sao: Sẵn sàng, Đang mượn, Đang giữ chỗ, Đang sửa, Mất.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="text-xs font-semibold">Tên sách</TableHead>
                        <TableHead className="text-center text-xs font-semibold">Sẵn sàng</TableHead>
                        <TableHead className="text-center text-xs font-semibold">Đang mượn</TableHead>
                        <TableHead className="text-center text-xs font-semibold">Khác</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Tổng</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {copyStatus.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                            Chưa có dữ liệu trạng thái bản sao.
                          </TableCell>
                        </TableRow>
                      ) : (
                        copyStatus.map((c) => (
                          <TableRow key={c.bookId} className="text-xs font-mono">
                            <TableCell className="font-sans font-medium max-w-[180px] truncate">
                              {c.title}
                            </TableCell>
                            <TableCell className="text-center text-emerald-600 font-bold">
                              {c.available}
                            </TableCell>
                            <TableCell className="text-center text-amber-600">
                              {c.onLoan}
                            </TableCell>
                            <TableCell className="text-center text-muted-foreground">
                              {c.onHold + c.inRepair + c.lost}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {c.total}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
