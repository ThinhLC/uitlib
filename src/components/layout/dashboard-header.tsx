'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Database, ShieldCheck, Sparkles } from 'lucide-react';

const ROUTE_MAP: Record<string, { label: string; parent?: { label: string; href: string } }> = {
  '/': { label: 'Bảng điều khiển' },
  '/catalog': { label: 'Tra cứu kho sách' },
  '/reader': { label: 'Cổng bạn đọc cá nhân', parent: { label: 'Dịch vụ bạn đọc', href: '/reader' } },
  '/desk': { label: 'Quầy thủ thư lưu thông', parent: { label: 'Nghiệp vụ thư viện', href: '/desk' } },
  '/admin/reports': {
    label: 'Báo cáo & Kiểm toán CSDL',
    parent: { label: 'Quản trị hệ thống', href: '/admin/reports' },
  },
  '/dev/auth': { label: 'Chuyển đổi vai trò Dev', parent: { label: 'Công cụ phát triển', href: '/dev/auth' } },
};

export function DashboardHeader() {
  const pathname = usePathname();

  // Determine current breadcrumbs
  let currentConfig = ROUTE_MAP[pathname];
  if (!currentConfig && pathname.startsWith('/catalog/')) {
    currentConfig = {
      label: 'Chi tiết ấn phẩm',
      parent: { label: 'Tra cứu kho sách', href: '/catalog' },
    };
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-md transition-[width,height] ease-linear">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink render={<Link href="/" />}>
                NexusLib
              </BreadcrumbLink>
            </BreadcrumbItem>
            {currentConfig?.parent && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink render={<Link href={currentConfig.parent.href} />}>
                    {currentConfig.parent.label}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold text-foreground">
                {currentConfig?.label || 'Tổng quan'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-3">
        <Badge
          variant="outline"
          className="hidden sm:inline-flex items-center gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-mono text-[11px]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <Database className="h-3 w-3" />
          <span>MySQL 8.4 LTS</span>
        </Badge>

        <Badge
          variant="secondary"
          className="hidden md:inline-flex items-center gap-1 text-[11px] font-normal"
        >
          <ShieldCheck className="h-3 w-3 text-primary" />
          <span>UIT Invariants OK</span>
        </Badge>
      </div>
    </header>
  );
}
