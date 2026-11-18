# Social inbox: setting it up

The social inbox (ADR-064) lets a business connect its Facebook Pages, Instagram professional
accounts and TikTok business account, and read and answer customers' direct messages in Meroidea.
The code is built; what stands between it and a client business is a one-time setup by the
platform owner with Meta and TikTok, including their reviews. This page is that checklist.

Requirements below were checked against Meta's and TikTok's developer documentation in
November 2026. Both change often: re-check the linked pages before submitting a review.

## 1. Meta (Facebook and Instagram)

One Meta app serves both. Businesses log in with Facebook or Instagram ("Unified Login") and
choose which Pages and Instagram accounts to share; Instagram needs no Facebook Page.

1. **Meta Business portfolio and verification.** Business Verification is required before people
   without a role on the app (your clients) can use it. Have the ABN and business documents ready.
2. **Create the app** at developers.facebook.com: type *Business*, with the Messenger and Instagram
   use cases, and *Facebook Login for Business*.
3. **Login configuration.** Under Facebook Login for Business → Configurations, create one that
   issues a *System-user access token* (no expiry) and asks for: `pages_show_list`,
   `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`, `business_management`,
   `instagram_basic`, `instagram_manage_messages`. Its id is `META_LOGIN_CONFIG_ID`.
4. **Redirect address.** Valid OAuth redirect URI: `https://<your domain>/api/social/oauth/meta`.
5. **Webhooks.** Callback `https://<your domain>/api/webhooks/meta`, verify token =
   `META_WEBHOOK_VERIFY_TOKEN` (any long random string). Subscribe the Page object to `messages`
   and `message_echoes`, and Instagram to `messages`. Meroidea subscribes each account itself when
   a business connects it.
6. **App Review for Advanced Access** to the permissions above. Meta asks for a screencast of the
   whole flow: connecting from `/social/accounts`, a message arriving in `/social`, and a reply
   sent from the thread. Use a test Page and Instagram account you own; in development mode,
   people with a role on the app can already use everything, which is how to record it.
   Optionally request the *Human Agent* feature so replies between 24 hours and 7 days work.
7. **Privacy policy and data deletion.** The app needs a privacy policy URL and a data deletion
   instructions URL (a page explaining that a business disconnects in `/social/accounts` and can
   ask the platform owner to delete stored messages).
8. **Settings** (Vercel, production): `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
   `META_WEBHOOK_VERIFY_TOKEN`, and `META_GRAPH_VERSION` (default `v27.0`; move it forward when Meta
   retires that version).

## 2. TikTok

1. **Developer app** at business-api.tiktok.com (TikTok API for Business) with the *Business
   Messaging* permission, and the TikTok account holder redirect URL
   `https://<your domain>/api/social/oauth/tiktok`.
2. **Data security and privacy review.** Submit TikTok's intake form for Business Messaging API
   access. TikTok starts the review within about 10 working days and emails a questionnaire;
   supporting documents (ISO 27001, SOC 2, a recent penetration test) speed it up. Leave the US out
   of the application unless you serve US-registered accounts: it adds a separate US review.
3. **Webhook.** Once approved, register `https://<your domain>/api/webhooks/tiktok` for the
   `DIRECT_MESSAGE` events through TikTok's `/business/webhook/update/` endpoint (once per app,
   not per business).
4. **Settings:** `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, and `TIKTOK_AUTH_URL` (the "TikTok account
   holder authorization URL" shown on the app's page; Meroidea adds the `state`).

## 3. Switch it on for a business

In `/platform`, open the business and tick **Social inbox**. Its Admin then sees
**Customer care → Social inbox → Connected accounts** and connects their accounts. Managers can
read and reply; give other roles `social.view` / `social.reply` in Settings → Roles.

What the business needs:
- **Facebook:** to be an admin of the Page (task "Messaging").
- **Instagram:** a professional (business or creator) account.
- **TikTok:** a Verified Business Account (or one with Advanced Access), owned by someone over 18,
  set to accept direct messages from everyone, and not registered in the EEA, Switzerland or the UK.

## 4. Limits to tell businesses

- Replies: within 24 hours of the customer's last message on Facebook and Instagram (up to 7 days
  as a reply from a person, once Meta approves Human Agent); TikTok allows 10 replies within 48
  hours of each customer message. Meroidea explains this in the reply box instead of failing.
- History: on connecting, the latest 25 conversations are imported, with up to 20 messages each
  (the platforms return no more). TikTok keeps only the last 90 days.
- One business per account: an account already connected elsewhere is skipped.
- Text replies only for now; images and files customers send are shown as links.
