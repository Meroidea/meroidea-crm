# Social inbox: setting it up

The inbox also takes email, under its own feature: see [email-inbox.md](email-inbox.md)
(ADR-070). In the app the menu now says **Inbox**.

The social inbox (ADR-064, ADR-066) lets a business connect its Facebook Pages, Instagram
professional accounts, WhatsApp number and TikTok business account, and read and answer customers'
messages in Meroidea. It lives under **Marketing** in the menu.
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
   `META_WEBHOOK_VERIFY_TOKEN` (any long random string). Subscribe the Page object to `messages`,
   `message_echoes`, `message_deliveries` and `message_reads`, and Instagram to `messages` and
   `messaging_seen` (for "delivered" and "read" on replies). Meroidea subscribes each account
   itself when a business connects it.
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

## 2. WhatsApp (same Meta app)

WhatsApp runs through the same Meta app as section 1, with the platform as a **Tech Provider**
(ADR-066). Facts checked against Meta's WhatsApp Business Platform documentation in November
2026.

1. **Add WhatsApp to the app** in the App Dashboard (use case *Connect with customers through
   WhatsApp*). Business Verification from section 1 is a prerequisite.
2. **App Review for Advanced Access** to `whatsapp_business_messaging` and
   `whatsapp_business_management`. Meta asks for two videos:
   - a message sent from Meroidea and received in WhatsApp (send a reply from a test number's
     conversation);
   - a template created in Meroidea (Marketing → WhatsApp templates → New template).

   Until approved and verified, at most 10 new WhatsApp accounts can be onboarded in a rolling
   7 days (200 after).
3. **Embedded Signup configuration.**
   - Under Facebook Login for Business → Configurations, create one from the template *WhatsApp
     Embedded Signup Configuration With 60 Expiration Token*, or a custom one with the two
     permissions above. Use the current Embedded Signup version: v2 and v3 were retired on
     15 October 2026.
   - Add your domain to *Allowed domains* and *Valid OAuth redirect URIs*. Meta returns the
     result to the page only for listed domains.
   - The configuration's id is `META_WHATSAPP_CONFIG_ID`.
4. **Webhook fields.** On the WhatsApp product's webhook, use the same callback and verify token
   as section 1 (`/api/webhooks/meta`). Subscribe to `messages`, `smb_message_echoes`, `history`,
   `smb_app_state_sync`, `message_template_status_update` and `account_update`. Meroidea
   subscribes each business's WhatsApp account itself when it connects a number.
5. **Settings** (Vercel, production): `META_WHATSAPP_CONFIG_ID`, plus section 1's `META_APP_ID`,
   `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`.
6. **The page loads Meta's SDK** (`connect.facebook.net`) on Connected accounts only, after an
   admin clicks *Connect WhatsApp*, as approved. If a content security policy is added later, it
   must allow that script and Facebook's popup on that page.

What the business needs:
- A Meta business portfolio, and a payment method on its WhatsApp account in Meta Business Suite
  (Billing & payments).
  - Meta charges the business directly for templates, and for replies inside the 24 hours beyond
    1,000 a month per number (since 1 October 2026).
  - Without a payment method, replies beyond the free 1,000 are not delivered.
- Either a number not yet on WhatsApp, or the number on its WhatsApp Business app (version 2.24.17
  or later).
  - With the app, it keeps using the app; chats from the last 180 days are imported (photos only
  from the last 14 days).
  - The history import must start within 24 hours, which Meroidea does at once.
  - Groups, broadcast lists and calls stay in the app only.

## 3. Supabase Realtime (live updates)

In the Supabase dashboard of the production project: **Realtime → Settings → switch off "Allow
public access"**, so only private, authorised channels exist. Nothing else to configure: the
migration adds the channel policy, and the inbox shows "Live" when connected (it falls back to a
30-second refresh otherwise). Saved customer media live in the private `social-media` bucket,
created by the migration; its size is the platform's cost.

## 4. TikTok

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
4. **Signatures.** Meroidea checks `TikTok-Signature` (`t=…,s=…`, HMAC-SHA256 of `t.body` with
   the app secret). Confirm on the developer portal that Business Messaging webhooks are signed
   this way: until a notification is signed, it still works but is throttled, and read receipts
   from TikTok are not applied.
5. **Settings:** `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, and `TIKTOK_AUTH_URL` (the "TikTok account
   holder authorization URL" shown on the app's page; Meroidea adds the `state`).

## 5. Switch it on for a business

In `/platform`, open the business and tick **Social inbox**. Its Admin then opens **Marketing →
Social inbox → Settings → Connected accounts** and connects their accounts; **WhatsApp templates**
joins that Settings menu once a WhatsApp number is connected (ADR-073). Email is a separate area,
**Marketing → Email**, under its own feature. Managers can read and reply; give other
roles `social.view` / `social.reply` in Settings → Roles.

What the business needs:
- **Facebook:** to be an admin of the Page (task "Messaging").
- **Instagram:** a professional (business or creator) account.
- **TikTok:** a Verified Business Account (or one with Advanced Access), owned by someone over 18,
  set to accept direct messages from everyone, and not registered in the EEA, Switzerland or the UK.

## 6. Limits to tell businesses

- Replies:
  - Facebook and Instagram: within 24 hours of the customer's last message, or up to 7 days as a
    reply from a person once Meta approves Human Agent.
  - WhatsApp: free text within 24 hours, then an approved template only.
  - TikTok: 10 replies within 48 hours of each customer message.

  Meroidea explains this in the reply box instead of failing.
- History: on connecting, the latest 25 conversations are imported, with up to 20 messages each
  (the platforms return no more). TikTok keeps only the last 90 days.
- One business per account: an account already connected elsewhere is skipped.
- Replies can carry a photo or file (ADR-067):
  - WhatsApp: JPEG and PNG up to 5 MB, MP4 video and audio up to 16 MB, PDF and Office files,
    with a caption.
  - Messenger: images, video, audio and files up to 16 MB.
  - Instagram: JPEG and PNG up to 8 MB, video and audio, and PDF only.
  - TikTok: JPG and PNG up to 3 MB, without words.
  - Where words cannot go with a file, they follow as a second reply.
- Customers' own photos, videos, voice notes and files are saved and shown in the thread. A file
  type Meroidea does not keep is marked as not saved.
- Templates with a picture heading, a button value or a code are sent from WhatsApp Manager.
- Opening a conversation with new messages marks them read for the customer on WhatsApp (blue
  ticks) and Messenger ("seen"). Instagram and TikTok offer businesses no such call.
- Conversations can be assigned to a colleague, snoozed, and searched by name, number or what
  was said.
- Inbox foundations (ADR-068):
  - Colleagues can leave private notes in a conversation. Notes are never sent to the customer.
  - Saved replies are typed with `/` in the reply box (Marketing → Saved replies).
  - The inbox shows who else has a conversation open, and who is typing.
  - A WhatsApp sender whose number belongs to exactly one contact is linked to that contact
    automatically. When several contacts share the number, staff choose which one it is.
  - Each account can be set to make a new lead for unknown senders (Connected accounts). This is
    off by default.
  - A contact's conversations show on their timeline.

  Presence uses the same Realtime setup as section 3: there is nothing extra to configure.
- Helpdesk (ADR-069):
  - Any conversation can be made into a ticket from its details panel. The ticket is linked to
    the customer's contact, their organization and their open opportunities.
  - Replies written on the ticket go to the customer on the conversation's channel.
  - Each account can open a ticket for every new conversation (Connected accounts). This is off
    by default.
  - A customer writing again reopens a ticket that was waiting on them or solved.
