"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Library,
  BookOpen,
  CreditCard,
  Barcode,
  BarChart3,
  Users,
  KeyRound,
  LogOut,
  LogIn,
  Home,
  ChevronUp,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { apiFetch } from "@/lib/api/client";
import { endpoints, type Me } from "@/lib/api/contract";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session } from "@supabase/supabase-js";

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị",
  librarian: "Thủ thư",
  reader: "Bạn đọc",
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [me, setMe] = React.useState<Me | null>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    );
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  React.useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    apiFetch(endpoints.me, {}, { token: session.access_token })
      .then(setMe)
      .catch(() => setMe(null));
  }, [session]);

  const roles = me?.roles ?? [];
  const isLibrarian = roles.includes("librarian") || roles.includes("admin");
  const isAdmin = roles.includes("admin");

  const navigationGroups = [
    {
      label: "Tổng quan & Tra cứu",
      items: [
        { title: "Trang chủ", url: "/", icon: Home },
        { title: "Tra cứu kho sách", url: "/catalog", icon: BookOpen },
      ],
    },
    {
      label: "Dịch vụ bạn đọc",
      items: [
        { title: "Sách tôi đang mượn", url: "/reader", icon: CreditCard },
      ],
    },
    ...(isLibrarian
      ? [
          {
            label: "Nghiệp vụ lưu thông",
            items: [
              { title: "Quầy thủ thư (Desk)", url: "/desk", icon: Barcode },
              { title: "Quản lý bạn đọc", url: "/desk/readers", icon: Users },
            ],
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: "Quản trị hệ thống",
            items: [
              {
                title: "Báo cáo & Kiểm tra DB",
                url: "/admin/reports",
                icon: BarChart3,
              },
            ],
          },
        ]
      : []),
    {
      label: "Công cụ phát triển",
      items: [{ title: "Đăng nhập Dev", url: "/dev/auth", icon: KeyRound }],
    },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Sidebar Header */}
      <SidebarHeader className="border-b px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <Library className="h-5 w-5" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold">NexusLib</span>
                <span className="truncate text-[11px] text-muted-foreground font-mono">
                  UIT Database v0.1.0
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Sidebar Nav Items */}
      <SidebarContent>
        {navigationGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.url ||
                    (item.url !== "/" && pathname.startsWith(item.url));
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        render={<Link href={item.url} />}
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Sidebar Footer with User Profile */}
      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    />
                  }
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-bold text-xs uppercase">
                      {session.user.email?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-xs">
                      {session.user.email}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {roles.map((r) => ROLE_LABELS[r] || r).join(", ") ||
                        "Người dùng"}
                    </span>
                  </div>
                  <ChevronUp className="ml-auto h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-56 rounded-lg"
                  side="top"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="p-0 font-normal">
                      <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                        <Avatar className="h-8 w-8 rounded-lg">
                          <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-bold text-xs uppercase">
                            {session.user.email?.[0] || "U"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-xs leading-tight">
                          <span className="truncate font-medium">
                            {session.user.email}
                          </span>
                          <div className="flex gap-1 mt-0.5">
                            {roles.map((r) => (
                              <Badge
                                key={r}
                                variant="outline"
                                className="text-[9px] py-0"
                              >
                                {ROLE_LABELS[r] || r}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    render={<Link href="/reader" />}
                    className="cursor-pointer text-xs"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Hồ sơ mượn sách
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={<Link href="/dev/auth" />}
                    className="cursor-pointer text-xs"
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    Chuyển đổi tài khoản (Dev)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => supabase.auth.signOut()}
                    className="cursor-pointer text-xs text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Đăng xuất
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton size="lg" render={<Link href="/dev/auth" />}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <LogIn className="h-4 w-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="font-semibold text-xs">Chưa đăng nhập</span>
                  <span className="text-[10px] text-muted-foreground">
                    Nhấn để đăng nhập
                  </span>
                </div>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
