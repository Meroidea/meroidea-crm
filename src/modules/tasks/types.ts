export type TaskRow = {
  id: string;
  title: string;
  type: 'call' | 'email' | 'meeting' | 'follow_up' | 'document' | 'other';
  status: 'open' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  dueAt: Date | null;
  completedAt: Date | null;
  assignedTo: string;
  assigneeName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
};
