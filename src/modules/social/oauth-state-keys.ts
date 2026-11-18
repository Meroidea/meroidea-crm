/** The two places a business logs in to connect accounts: Meta (Facebook and Instagram) and TikTok. */
export const OAUTH_PROVIDERS = ['meta', 'tiktok'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
