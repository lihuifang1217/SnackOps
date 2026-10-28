import { cn } from '@/lib/utils';

export function Card({
  className,
  ...props
}: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('rounded-xl border bg-card shadow-[0_1px_2px_rgba(40,36,28,0.03)]', className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-sm font-semibold text-foreground', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-xs leading-5 text-muted-foreground', className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-5', className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center border-t px-5 py-3', className)} {...props} />;
}
