import { Badge } from '@/components/ui/badge';
import type { SignRequestStatus } from '@/modules/esign/types';

const LABELS: Record<SignRequestStatus | 'expired', string> = {
  draft: 'Draft',
  sent: 'Out for signature',
  completed: 'Completed',
  declined: 'Declined',
  voided: 'Voided',
  expired: 'Expired',
};

export function RequestStatusBadge({
  status,
  expired,
}: {
  status: SignRequestStatus;
  expired: boolean;
}) {
  const shown = expired ? 'expired' : status;
  const variant =
    shown === 'completed'
      ? 'default'
      : shown === 'declined' || shown === 'expired'
        ? 'destructive'
        : shown === 'sent'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{LABELS[shown]}</Badge>;
}
