import type { SocialPlatform } from './providers/types';

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: 'Connected',
  needs_reconnect: 'Needs reconnecting',
  disconnected: 'Disconnected',
};

/** The customer as the inbox names them: their name, else their handle, else the platform's word. */
export function customerLabel(row: {
  participantName: string | null;
  participantUsername: string | null;
  platform: SocialPlatform;
}): string {
  if (row.participantName) return row.participantName;
  if (row.participantUsername) return `@${row.participantUsername}`;
  return `${PLATFORM_LABELS[row.platform]} customer`;
}
