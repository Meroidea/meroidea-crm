'use client';

import { RecordActionsMenu } from '@/components/data/record-actions-menu';
import { deleteOpportunityAction } from '@/modules/opportunities/actions';

export function OpportunityActions({
  id,
  name,
  canDelete,
}: {
  id: string;
  name: string;
  canDelete: boolean;
}) {
  return (
    <RecordActionsMenu
      recordName={name}
      afterDeleteHref="/opportunities"
      onDelete={canDelete ? () => deleteOpportunityAction({ id }) : undefined}
    />
  );
}
