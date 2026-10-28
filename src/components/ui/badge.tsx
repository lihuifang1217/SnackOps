import { cn } from '@/lib/utils';

const toneClasses = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
  accent: 'border-orange-200 bg-orange-50 text-orange-900',
} as const;

export type BadgeTone = keyof typeof toneClasses;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium leading-none',
        toneClasses[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </span>
  );
}
