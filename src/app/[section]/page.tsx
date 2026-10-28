import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CircleDashed, Database, LayoutPanelTop } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isModuleKey, moduleKeys, modules } from '@/lib/modules';

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export function generateStaticParams() {
  return moduleKeys
    .filter((section) => section !== 'tickets' && section !== 'evals')
    .map((section) => ({ section }));
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  if (!isModuleKey(section)) return { title: '页面不存在' };
  return {
    title: modules[section].title,
    description: modules[section].description,
  };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  if (!isModuleKey(section)) notFound();

  const currentModule = modules[section];

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">SNACKOPS / {currentModule.title}</p>
          <h1 className="page-title">{currentModule.title}</h1>
          <p className="page-subtitle">{currentModule.description}</p>
        </div>
        <Badge tone={currentModule.tone}>{currentModule.status}</Badge>
      </header>

      <div className="module-grid">
        <Card>
          <CardHeader>
            <CardTitle>模块骨架</CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">
              路由、布局、数据契约与错误边界已就绪。以下能力将在后续迭代中逐项接入。
            </p>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {currentModule.nextSteps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-xs">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-card font-mono text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="break-words">{step}</span>
                  </span>
                  <span className="shrink-0 text-[10px] font-medium text-muted-foreground">待开发</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>数据来源</CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">
              这些文件只由服务端存储模块读取，客户端通过 API 获取数据。
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {currentModule.dataFiles.map((file) => (
                <li key={file} className="flex items-center gap-2 text-xs">
                  <Database className="size-3.5 text-muted-foreground" aria-hidden />
                  <code className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
                    data/{file}
                  </code>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-2 text-[11px] font-medium">
                <LayoutPanelTop className="size-3.5 text-primary" aria-hidden />
                当前阶段仅展示骨架
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                未接入业务写操作，避免在基础数据层稳定前引入不可追踪的状态。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="empty-state rounded-xl border bg-card">
        <CircleDashed className="size-7 text-primary" aria-hidden />
        <p className="text-sm font-medium">模块入口已就绪，等待功能开发</p>
        <p className="max-w-md text-xs leading-5">
          当前迭代只负责项目骨架、JSON 存储和全局体验。后续会按模块逐项接入列表、详情与操作流程。
        </p>
        <Link
          href="/"
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          返回运营总览
        </Link>
      </div>
    </div>
  );
}
