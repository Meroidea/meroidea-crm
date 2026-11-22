import type { SocialPlatform } from './providers/types';

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: 'Connected',
  needs_reconnect: 'Needs reconnecting',
  disconnected: 'Disconnected',
};

/**
 * The customer as the inbox names them: their name, else their handle or WhatsApp number, else
 * the platform's word.
 */
export function customerLabel(row: {
  participantName: string | null;
  participantUsername: string | null;
  participantPhone?: string | null;
  participantEmail?: string | null;
  platform: SocialPlatform;
}): string {
  if (row.participantName) return row.participantName;
  if (row.participantUsername) return `@${row.participantUsername}`;
  if (row.participantPhone) return `+${row.participantPhone}`;
  if (row.participantEmail) return row.participantEmail;
  return `${PLATFORM_LABELS[row.platform]} customer`;
}

/** WhatsApp template states as the business reads them. */
export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  pending: 'In review',
  in_appeal: 'In appeal',
  rejected: 'Rejected',
  paused: 'Paused',
  disabled: 'Disabled',
  flagged: 'Flagged',
  limit_exceeded: 'Limit reached',
  pending_deletion: 'Being deleted',
  deleted: 'Deleted',
  archived: 'Archived',
};

export const HISTORY_SYNC_LABELS: Record<string, string> = {
  requested: 'Waiting for WhatsApp to send the app’s chats',
  in_progress: 'Importing the app’s chats',
  complete: 'App chats imported',
  declined: 'Chat history sharing is off in the WhatsApp Business app',
  failed: 'The app’s chats could not be imported',
};
