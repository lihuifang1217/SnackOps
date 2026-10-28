import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SnackOps · 零食客服 Agent 运营台',
    template: '%s · SnackOps',
  },
  description: '零食电商客服 Agent、Skill、Tool 与 Eval 的运营工作区。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8f6f1',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main-content" className="skip-link">
          跳到主要内容
        </a>
        <AppShell>{children}</AppShell>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
