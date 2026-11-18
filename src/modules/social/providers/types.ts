export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type ProviderAttachment = { type: string; url?: string };

/** A message as a provider reports it, before it is stored. */
export type ProviderMessage = {
  externalId: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  attachments: ProviderAttachment[];
  sentAt: Date;
};

/** A customer's thread as a provider reports it. */
export type ProviderConversation = {
  /** The provider's own conversation id, where it has one. */
  externalId: string | null;
  /** The customer's id as the provider scopes it to the business's account. */
  participantId: string;
  participantName: string | null;
  participantUsername: string | null;
  messages: ProviderMessage[];
};

/** An account found after a business authorised Meroidea, with the token that reaches it. */
export type DiscoveredAccount = {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  providerBusinessId: string | null;
  accessToken: string;
  accessExpiresAt: Date | null;
  refreshToken: string | null;
  refreshExpiresAt: Date | null;
};

/** The parts of a connected account a provider call needs. */
export type AccountRef = { platform: SocialPlatform; externalId: string; username: string | null };

/**
 * A provider refused or failed. `message` is safe to show the business and to log: it never
 * holds a token, a URL with a token, or a message's content. `reconnect` means the stored
 * authorisation no longer works and the business must connect the account again.
 */
export class ProviderError extends Error {
  constructor(
    readonly platform: SocialPlatform | 'meta',
    message: string,
    readonly reconnect = false,
    readonly code: string | number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** First 140 characters, for the inbox list. */
export function previewOf(message: Pick<ProviderMessage, 'body' | 'attachments'>): string {
  const text = message.body?.replace(/\s+/g, ' ').trim();
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  const kind = message.attachments[0]?.type;
  return kind ? `[${kind}]` : '[message]';
}
