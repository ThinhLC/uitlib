'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Search,
  ShieldCheck,
  CreditCard,
  Barcode,
  ArrowRight,
  Database,
  BarChart3,
  Layers,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/catalog?q=${encodeURIComponent(query.trim())}`);
    } else {
      router.push('/catalog');
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-primary/10 via-primary/5 to-background p-6 lg:p-8 shadow-xs">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-semibold text-primary backdrop-blur-md shadow-xs">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Hệ thống Quản lý Thư viện Đại học UIT · Môn Cơ sở Dữ liệu</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-foreground">
            Bảng Điều Khiển <span className="text-primary">NexusLib</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Hệ thống quản trị thư viện toàn diện vận hành trên cơ sở dữ liệu MySQL 8.4 LTS với các Stored Procedures
            đảm bảo tính toàn vẹn (ACID), xác thực phân quyền Supabase và giao diện Shadcn Admin hiện đại.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/desk">
            <Button size="sm" className="gap-2 text-xs h-9 shadow-xs">
              <Barcode className="h-4 w-4" />
              Mở quầy lưu thông
            </Button>
          </Link>
          <Link href="/desk/readers">
            <Button size="sm" variant="outline" className="gap-2 text-xs h-9">
              <Users className="h-4 w-4" />
              Quản lý bạn đọc
            </Button>
          </Link>
          <Link href="/catalog">
            <Button size="sm" variant="outline" className="gap-2 text-xs h-9">
              <BookOpen className="h-4 w-4" />
              Tra cứu kho sách
            </Button>
          </Link>
        </div>
      </div>

      {/* Global Quick Search Box */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Tra cứu nhanh tên sách, tác giả, thể loại, từ khóa ISBN..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 pl-10 pr-4 text-xs sm:text-sm rounded-lg"
              />
            </div>
            <Button type="submit" className="h-11 px-6 rounded-lg gap-2 text-xs sm:text-sm font-medium w-full sm:w-auto">
              Tìm kiếm tài liệu
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 4 Stat Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Kho Sách & Bản Sao</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <BookOpen className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">Tra Cứu Trực Tuyến</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Theo dõi số lượng bản sao sẵn có trên giá thời gian thực
            </p>
            <Link href="/catalog" className="inline-flex items-center text-xs text-primary font-medium mt-3 gap-1 hover:underline">
              Xem danh mục <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        {/* Card 2 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Dịch Vụ Bạn Đọc</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <CreditCard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">Cổng Bạn Đọc</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Đếm ngược hạn trả sách, gia hạn và lịch sử phạt
            </p>
            <Link href="/reader" className="inline-flex items-center text-xs text-primary font-medium mt-3 gap-1 hover:underline">
              Hồ sơ mượn sách <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>

        {/* Card 3 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Nghiệp Vụ Lưu Thông</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Barcode className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">Quầy Thủ Thư</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Quét thẻ mượn, nhận trả, kiểm định sách hư hại, báo mất
            </p>
            <div className="flex items-center gap-3 mt-3">
              <Link href="/desk" className="inline-flex items-center text-xs text-primary font-medium gap-1 hover:underline">
                Quầy Desk <ArrowRight className="h-3 w-3" />
              </Link>
              <span className="text-muted-foreground text-xs">·</span>
              <Link href="/desk/readers" className="inline-flex items-center text-xs text-primary font-medium gap-1 hover:underline">
                Quản lý bạn đọc <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Card 4 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground">Kiểm Toán & Toàn Vẹn</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">Báo Cáo Invariants</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Kiểm toán luân chuyển nợ và kiểm tra bất biến CSDL
            </p>
            <Link href="/admin/reports" className="inline-flex items-center text-xs text-primary font-medium mt-3 gap-1 hover:underline">
              Xem báo cáo <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* System Features & Architecture Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Module Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Kiến Trúc & Quy Trình Nghiệp Vụ Thư Viện
            </CardTitle>
            <CardDescription className="text-xs">
              Các nguyên tắc thiết kế tuân thủ nghiêm ngặt đồ án Cơ sở Dữ liệu UIT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-xs">Stored Procedures Duy Nhất</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Mọi thao tác ghi/sửa dữ liệu đều thông qua Stored Procedures của MySQL (sp_checkout, sp_return, sp_reserve, sp_assess_fine). Client không ghi trực tiếp.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-xs">Kiểm Tra Bất Biến (Invariants)</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Bộ view v_inv_* liên tục giám sát tính toàn vẹn: số bản sao không âm, số sách mượn không vượt hạn mức, tổng tiền phạt bằng tiền đã thu cộng nợ còn lại.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <span className="font-semibold text-xs">Phân Quyền RBAC Phức Tạp</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Hỗ trợ 5 nhóm bạn đọc (Sinh viên, Học viên cao học, Nghiên cứu sinh, Giảng viên, Độc giả vãng lai) với các chính sách mượn sách riêng biệt.
                </p>
              </div>

              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-amber-600" />
                  <span className="font-semibold text-xs">Kiểm Toán Dòng Tiền Phạt</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Báo cáo Debt Rollforward theo chuẩn tài chính: Nợ đầu kỳ + Phạt phát sinh + Điều chỉnh - Đã thu = Nợ cuối kỳ.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Testing Callout */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-2">
              Môi trường kiểm thử
            </div>
            <CardTitle className="text-base">Chuyển Đổi Vai Trò Dev</CardTitle>
            <CardDescription className="text-xs">
              Đăng nhập tức thì bằng các tài khoản kiểm thử đã tạo sẵn trong cơ sở dữ liệu mẫu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted/60 p-3 text-xs space-y-1 font-mono">
              <div className="text-[11px] text-muted-foreground">Tài khoản có sẵn:</div>
              <div>• admin@uit.edu.vn (Admin)</div>
              <div>• librarian@uit.edu.vn (Thủ thư)</div>
              <div>• reader1@uit.edu.vn (Bạn đọc)</div>
            </div>
            <Link href="/dev/auth" className="block">
              <Button variant="outline" className="w-full gap-2 text-xs">
                Mở trang Dev Auth
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
