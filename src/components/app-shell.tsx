'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  Cookie,
  Cpu,
  Database,
  FlaskConical,
  History,
  ClipboardList,
  LayoutDashboard,
  MessagesSquare,
  Settings2,
  Sparkles,
  Wrench,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { modules } from '@/lib/modules';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: '工作区',
    items: [
      { href: '/', label: 'Agent 工作台', icon: Bot },
      { href: '/demo', label: '零食小助手', icon: MessagesSquare },
      { href: '/runs', label: '运行记录', icon: History },
      { href: '/overview', label: '运营总览', icon: LayoutDashboard },
      { href: '/ops', label: '运营中心', icon: ClipboardList },
      { href: '/tickets', label: modules.tickets.navLabel, icon: MessagesSquare },
    ],
  },
  {
    label: 'Agent 资产',
    items: [
      { href: '/skills', label: '技能管理', icon: Sparkles },
      { href: '/tools', label: '工具管理', icon: Wrench },
      { href: '/planner', label: 'Planner 管理', icon: Workflow },
      { href: '/catalog', label: '业务数据目录', icon: Database },
      { href: '/evals', label: modules.evals.navLabel, icon: FlaskConical },
    ],
  },
  {
    label: '配置',
    items: [
      { href: '/models', label: '模型管理', icon: Cpu },
      { href: '/settings', label: modules.settings.navLabel, icon: Settings2 },
    ],
  },
];

const flatItems = groups.flatMap((group) => group.items);

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = flatItems.find((item) => isActive(pathname, item.href));
  const currentLabel = current?.label ?? '工作区';

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <Link href="/" className="brand" aria-label="SnackOps 运营总览">
          <span className="brand-mark" aria-hidden>
            <Cookie className="size-5" />
          </span>
          <span className="brand-name">
            Snack<span>Ops</span>
          </span>
        </Link>

        <div className="workspace-chip">
          <span className="workspace-avatar" aria-hidden>
            SO
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">零食客服运营台</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">本地单机工作区</p>
          </div>
        </div>

        <nav aria-label="主导航" className="side-nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn('nav-item', active && 'nav-item-active')}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-note">
          <p className="flex items-center gap-2 text-[11px] font-semibold">
            <Database className="size-3.5" aria-hidden />
            能力注册中心
          </p>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
            Planner 只读取启用能力；每次运行都会持久化计划、Trace、风险与评分。
          </p>
        </div>
      </aside>

      <div className="app-body">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">零食客服运营</span>
            <span aria-hidden className="hidden text-border sm:inline">
              /
            </span>
            <span className="truncate font-medium text-foreground">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="topbar-chip">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              本地环境
            </span>
            <span className="topbar-version">v0.3.0</span>
          </div>
        </header>

        <main id="main-content" className="app-main">
          {children}
        </main>

        <footer className="app-footer">
          <span>SnackOps · 零食电商客服 Agent 运营平台</span>
          <span>Next.js 16 · Agent 主链路 · JSON Store</span>
        </footer>
      </div>
    </div>
  );
}
