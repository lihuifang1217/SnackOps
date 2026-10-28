'use client';

import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="empty-state rounded-xl border bg-card">
      <TriangleAlert className="size-8 text-primary" aria-hidden />
      <h1 className="text-base font-semibold">页面暂时无法加载</h1>
      <p className="max-w-md text-xs leading-5">
        服务端数据读取或页面渲染遇到错误。请重试；若持续失败，请检查 JSON 数据文件和服务端日志。
      </p>
      {error.digest ? (
        <p className="font-mono text-[10px] text-muted-foreground">错误编号：{error.digest}</p>
      ) : null}
      <Button
        onClick={() => {
          toast.info('正在重新加载页面');
          reset();
        }}
      >
        重试
      </Button>
    </div>
  );
}
