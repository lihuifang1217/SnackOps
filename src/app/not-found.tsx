import Link from 'next/link';
import { MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="empty-state rounded-xl border bg-card">
      <MapPinOff className="size-8 text-primary" aria-hidden />
      <p className="font-mono text-[10px] text-muted-foreground">404</p>
      <h1 className="text-base font-semibold">页面不存在</h1>
      <p className="max-w-md text-xs leading-5">
        当前地址不在 SnackOps 的导航范围内。请从运营总览重新进入已建立的模块。
      </p>
      <Button asChild variant="outline">
        <Link href="/">返回运营总览</Link>
      </Button>
    </div>
  );
}
