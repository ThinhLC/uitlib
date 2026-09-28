import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import './globals.css';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { TooltipProvider } from '@/components/ui/tooltip';

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
});

const robotoMono = Roboto_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin', 'vietnamese'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NexusLib — Hệ thống Quản trị Thư viện Đại học (UIT)',
  description: 'Hệ thống quản trị thư viện trường đại học xây dựng với Next.js, MySQL 8.4 và Supabase Auth.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${roboto.variable} ${robotoMono.variable} font-sans h-full antialiased`}>
      <body className="min-h-full font-sans bg-background text-foreground">
        <TooltipProvider>
          <SidebarProvider defaultOpen={true}>
            <AppSidebar />
            <SidebarInset className="flex flex-col min-h-screen">
              <DashboardHeader />
              <main className="flex-1 p-4 md:p-6 lg:p-8 bg-muted/20">
                {children}
              </main>
              <footer className="border-t py-4 text-center text-xs text-muted-foreground bg-background px-4">
                <div className="mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
                  <p>© 2026 NexusLib · Quản trị Thư viện UIT · Môn Cơ sở Dữ liệu (CSDL)</p>
                  <p className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                    MySQL 8.4 LTS · Đảm bảo toàn vẹn Invariants
                  </p>
                </div>
              </footer>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
