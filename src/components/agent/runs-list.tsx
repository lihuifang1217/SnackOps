'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  History,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiRequest, formatDateTime } from '@/lib/client';
import { RunConversation } from '@/components/agent/run-conversation';
import type { RunsResponse } from '@/lib/types';
import { RunStatusBadge } from '@/components/agent/run-view';

export function RunsList() {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<RunsResponse>(`/api/runs?page=${targetPage}&limit=20`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
    setPage(result.data.page);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const result = await apiRequest<RunsResponse>('/api/runs?page=1&limit=20');
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setPage(result.data.page);
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  const runs = data?.runs ?? [];

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT / RUN HISTORY</p>
          <h1 className="page-title">运行记录</h1>
          <p className="page-subtitle">
            查看每次 Agent 的 Planner、Validator、Skill / Tool Trace、风险结果、评分报告与人工接管状态。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{data?.total ?? 0} 条记录</Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            刷新列表
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div role="status" className="empty-state">
              <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
              <p className="text-xs">正在读取运行记录…</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <History className="size-6" aria-hidden />
              <p className="text-sm font-medium">还没有运行记录</p>
              <p className="max-w-md text-[11px] leading-5">
                在 Agent 工作台或简化聊天中运行一次问题后，完整 RunRecord 会出现在这里。
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/">打开 Agent 工作台</Link>
              </Button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="run-table">
                <thead>
                  <tr>
                    <th scope="col">问题 / 上下文</th>
                    <th scope="col">状态</th>
                    <th scope="col">Provider</th>
                    <th scope="col">风险</th>
                    <th scope="col">步骤</th>
                    <th scope="col">耗时</th>
                    <th scope="col">时间</th>
                    <th scope="col">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <Fragment key={run.id}>
                    <tr>
                      <td className="max-w-[360px]">
                        <p className="line-clamp-2 whitespace-normal font-medium">{run.question}</p>
                        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{run.id}</p>
                        <button type="button" className="mt-1 text-[10px] font-medium text-primary hover:underline" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>
                          {expandedRunId === run.id ? '收起上下文' : `查看上下文（${run.conversationHistory?.length ?? 0} 条历史）`}
                        </button>
                      </td>
                      <td>
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td>
                        <p className="text-[11px]">{run.isDemo ? '课堂演示' : '真实模型'}</p>
                        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{run.provider}</p>
                      </td>
                      <td>
                        {run.riskResult ? (
                          <Badge tone={run.riskResult.decision === 'allow' ? 'success' : 'danger'}>
                            {run.riskResult.decision === 'allow' ? '放行' : '阻断'} · {run.riskResult.riskLevel}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">无结果</Badge>
                        )}
                      </td>
                      <td className="tabular-nums">{run.steps.length}</td>
                      <td className="tabular-nums">
                        {run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className="text-muted-foreground">{formatDateTime(run.createdAt)}</td>
                      <td>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/runs/${run.id}`}>
                            查看 Trace
                            <ArrowRight aria-hidden />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                    {expandedRunId === run.id ? (
                      <tr key={`${run.id}-context`}>
                        <td colSpan={8} className="bg-muted/20"><RunConversation run={run} compact /></td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {data && data.totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-[10px] text-muted-foreground">
              第 {data.page} / {data.totalPages} 页 · 共 {data.total} 条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page <= 1}
                onClick={() => void load(page - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page >= data.totalPages}
                onClick={() => void load(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
