'use client';

import { RecordActionsMenu } from '@/components/data/record-actions-menu';
import { deleteContactAction } from '@/modules/contacts/actions';

export function ContactActions({
  contactId,
  recordName,
  canDelete,
}: {
  contactId: string;
  recordName: string;
  canDelete: boolean;
}) {
  return (
    <RecordActionsMenu
      recordName={recordName}
      afterDeleteHref="/contacts"
      onDelete={canDelete ? () => deleteContactAction({ id: contactId }) : undefined}
    />
  );
}
