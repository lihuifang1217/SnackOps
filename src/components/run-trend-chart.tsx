'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RunTrendPoint } from '@/lib/types';

export function RunTrendChart({ data }: { data: RunTrendPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.success + point.handoff + point.failed, 0);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>近 7 日运行趋势</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            按最终状态统计 Agent 运行量，悬停可查看每日明细。
          </p>
        </div>
        <Badge tone="neutral">共 {total} 次</Badge>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="h-[228px] w-full" role="img" aria-label="近七日 Agent 运行次数柱状图">
          {total === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-center">
              <BarChart3 className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-xs font-medium">近 7 日暂无运行记录</p>
              <p className="text-[11px] text-muted-foreground">运行数据写入后会自动出现在这里。</p>
            </div>
          ) : (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minHeight={228}
              initialDimension={{ width: 640, height: 228 }}
            >
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barGap={4}>
                <CartesianGrid vertical={false} stroke="#eee9df" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#7b7468' }}
                  dy={8}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#7b7468' }}
                />
                <Tooltip
                  cursor={{ fill: '#f6f1e8' }}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #e7e2d8',
                    fontSize: 11,
                    boxShadow: '0 4px 16px rgba(40,36,28,0.08)',
                  }}
                  labelStyle={{ color: '#28241f', fontWeight: 600, marginBottom: 4 }}
                />
                <Legend
                  iconType="circle"
                  iconSize={7}
                  wrapperStyle={{ fontSize: 11, color: '#6f6a60', paddingTop: 8 }}
                />
                <Bar dataKey="success" name="成功" fill="#b4532a" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="handoff" name="转人工" fill="#d9a441" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="failed" name="失败" fill="#a8a29a" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          成功 {data.reduce((sum, point) => sum + point.success, 0)} 次 · 转人工{' '}
          {data.reduce((sum, point) => sum + point.handoff, 0)} 次 · 失败{' '}
          {data.reduce((sum, point) => sum + point.failed, 0)} 次
        </p>
      </CardContent>
    </Card>
  );
}
