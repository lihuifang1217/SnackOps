'use client';

import { useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, ServerCog, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import type { HealthSnapshot } from '@/lib/types';

const providerLabels: Record<string, string> = {
  fixture: '本地演示 Provider',
  'openai-compatible': 'OpenAI 兼容接口',
  coze: 'Coze 模型服务',
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

export function HealthPanel({ initial }: { initial: HealthSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { loading, execute } = useApi<HealthSnapshot>();

  async function recheck() {
    const result = await execute('/api/health');
    if (result.ok) {
      setSnapshot(result.data);
      setError(null);
      toast.success('服务检查完成', {
        description: `JSON 存储正常，共 ${result.data.datasetCount} 份数据集合可读。`,
      });
      return;
    }

    setError(result.error);
    toast.error('服务检查失败', { description: result.error });
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>系统状态</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            服务端 JSON 存储与运行配置检查
          </p>
        </div>
        <Badge tone="success">服务正常</Badge>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-emerald-900">存储读写通道可用</p>
              <p className="mt-1 text-[11px] leading-5 text-emerald-900/75">
                {snapshot.datasetCount} 份数据集合已注册，客户端不直接访问 data 文件。
              </p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30 py-3 text-center">
          <div className="px-2">
            <dt className="text-[10px] text-muted-foreground">商品</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">{snapshot.productCount}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[10px] text-muted-foreground">待处理工单</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">{snapshot.pendingTicketCount}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[10px] text-muted-foreground">启用能力</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {snapshot.enabledSkillCount + snapshot.enabledToolCount}
            </dd>
          </div>
        </dl>

        <div className="space-y-2 text-[11px] text-muted-foreground">
          <p className="flex items-start gap-2">
            <ServerCog className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Provider：{providerLabels[snapshot.provider] ?? snapshot.provider}
              <span className="ml-1 text-foreground">
                {snapshot.providerConfigured ? '· 已配置' : '· 未配置密钥'}
              </span>
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>最近检查：{formatTime(snapshot.checkedAt)}</span>
          </p>
        </div>

        {loading ? (
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            正在检查服务状态…
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-[11px] leading-5 text-red-800">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>检查失败：{error}</span>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="justify-between gap-3">
        <span className="text-[10px] text-muted-foreground">检查只读取数据，不写入文件</span>
        <Button variant="outline" size="sm" onClick={recheck} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden />
          {loading ? '检查中…' : '重新检查'}
        </Button>
      </CardFooter>
    </Card>
  );
}
