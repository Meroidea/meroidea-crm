import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/modules/purchasing/types';

const STATUS: Record<OrderStatus, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'border-transparent bg-primary text-primary-foreground' },
  not_sent: { label: 'Not sent', className: 'border-warning-border bg-warning text-warning-text' },
  cancelled: { label: 'Cancelled', className: 'border-border text-muted-foreground' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        STATUS[status].className,
      )}
    >
      {STATUS[status].label}
    </span>
  );
}
