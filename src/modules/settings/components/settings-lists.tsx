'use client';

import {
  addLeadSourceAction,
  addLostReasonAction,
  toggleLeadSourceAction,
  toggleLostReasonAction,
} from '@/modules/settings/actions';

import { ListEditor } from './list-editor';

export function LeadSourceList({
  items,
}: {
  items: { id: string; name: string; isActive: boolean; type: string }[];
}) {
  return (
    <ListEditor
      items={items.map((item) => ({ ...item, hint: item.type.replace('_', ' ') }))}
      addLabel="New source, e.g. Trade show"
      onAdd={(name) => addLeadSourceAction({ name })}
      onToggle={(id, isActive) => toggleLeadSourceAction({ id, isActive })}
    />
  );
}

export function LostReasonList({
  items,
}: {
  items: { id: string; name: string; isActive: boolean }[];
}) {
  return (
    <ListEditor
      items={items}
      addLabel="New reason, e.g. Budget cut"
      onAdd={(name) => addLostReasonAction({ name })}
      onToggle={(id, isActive) => toggleLostReasonAction({ id, isActive })}
    />
  );
}
