import { Badge } from '@/components/ui/badge';
import { CONTACT_STATUS_LABELS, type ContactStatus } from '@/modules/contacts/schemas';

const VARIANT: Record<ContactStatus, 'secondary' | 'outline' | 'destructive'> = {
  active: 'secondary',
  inactive: 'outline',
  do_not_contact: 'destructive',
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Badge variant={VARIANT[status]}>{CONTACT_STATUS_LABELS[status]}</Badge>;
}
