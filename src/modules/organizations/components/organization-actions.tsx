'use client';

import { RecordActionsMenu } from '@/components/data/record-actions-menu';
import { deleteOrganizationAction } from '@/modules/organizations/actions';

export function OrganizationActions({
  organizationId,
  recordName,
}: {
  organizationId: string;
  recordName: string;
}) {
  return (
    <RecordActionsMenu
      recordName={recordName}
      afterDeleteHref="/organizations"
      onDelete={() => deleteOrganizationAction({ id: organizationId })}
    />
  );
}
