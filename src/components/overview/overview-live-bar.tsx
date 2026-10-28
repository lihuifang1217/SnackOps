'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, LoaderCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/client';

export function OverviewLiveBar({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => {
      setRefreshing(false);
      toast.success('运营总览已刷新', {
        description: '指标、工单、运行记录和趋势来自最新服务端 JSON 数据。',
      });
    }, 700);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[10px] text-muted-foreground">
      <Badge tone="success"><Activity className="mr-1 size-3" aria-hidden />真实数据</Badge>
      <span>服务端实时聚合 products / tickets / skills / tools / runs / eval_cases</span>
      <span className="font-mono">生成于 {formatDateTime(generatedAt)}</span>
      <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="ml-auto">
        {refreshing ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {refreshing ? '刷新中…' : '刷新真实数据'}
      </Button>
    </div>
  );
}
