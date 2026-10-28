import { LoaderCircle } from 'lucide-react';

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="page-stack">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        正在加载运营数据…
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full max-w-lg animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-[104px] animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="h-[310px] animate-pulse rounded-xl border bg-card" />
        <div className="h-[310px] animate-pulse rounded-xl border bg-card" />
      </div>
      <div className="h-[260px] animate-pulse rounded-xl border bg-card" />
    </div>
  );
}
