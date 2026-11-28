# Email inbox: setting it up

The email inbox (ADR-070) gives a business an address whose emails arrive in its inbox, threaded,
with replies sent from that address. It runs on the platform's Resend account, the same one that
sends Meroidea's own emails (ADR-023). This page is the platform owner's one-time setup.

Facts below were checked against Resend's documentation on 22 November 2026. Re-check the linked
pages if anything here no longer matches the dashboard.

## 1. Choose the inbox domain

Use a subdomain only for this, for example `inbox.meroidea.com`.
- Resend receives mail for **every** address at a receiving domain: there is no list to keep.
- If the domain already has MX records, Resend's must have the lowest priority value, or mail
  will not arrive. A dedicated subdomain avoids that conflict with any existing mailboxes.

Every business's inbox address and every thread's reply address (`r-<random>@…`) live on this
domain.

## 2. Set the domain up in Resend

1. In Resend → **Domains**, add the subdomain and add the DNS records it shows (SPF and DKIM) so
   replies can be **sent** from it. Wait until it shows *Verified*.
2. On the same domain, **enable receiving** and add the **MX record** the dashboard shows. Copy
   its value exactly: it differs by region.
3. Send a test email to any address at the subdomain. It appears under Emails → Receiving.

## 3. Create the webhook

In Resend → **Webhooks**, add the endpoint `https://<your domain>/api/webhooks/resend` with these
events:
- `email.received`: new mail;
- `email.sent`: carries the Message-ID used to thread the customer's answer;
- `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`:
  delivery state on replies.

Copy the webhook's **signing secret** (it starts `whsec_`).

Meroidea checks every delivery's Svix signature over the raw body, and refuses anything older than
five minutes.

## 4. Settings (Vercel, production)

| Setting | Value |
|---|---|
| `RESEND_API_KEY` | A key with full access. It sends replies and reads received mail and its attachments. |
| `INBOX_EMAIL_DOMAIN` | The subdomain, e.g. `inbox.meroidea.com` (lower case) |
| `RESEND_WEBHOOK_SECRET` | The webhook's signing secret, `whsec_…` |

Without all three, the Email card says "Not available yet" and nothing is received.

A **sending-only** key is not enough: it sends Meroidea's own emails, but Resend refuses it when
the inbox reads a received email, so every email is refused and retried. Redeploy after changing
any of the three.

## Checking it works

- `POST https://<your domain>/api/webhooks/resend` with no signature answers `403` once
  `RESEND_WEBHOOK_SECRET` is set (`404` means it is not set in the running deployment).
- Send a test email to an inbox address. In Resend → Webhooks, its `email.received` event should
  show *Succeeded*.
- If it shows `500`, the production log has `[email] webhook not stored` with Resend's error code:
  - `restricted_api_key` or `401`: the key lacks full access;
  - `unexpected_response`: Resend's reply changed shape; compare it with `receivedSchema` in
    `src/modules/social/providers/resend.ts`.

Setup traps seen in practice:
- Resend plans limit how many domains an account has. Remove an unused one or upgrade before
  adding the inbox domain.
- Some DNS hosts (GoDaddy) save a new MX record with priority 0. Set the priorities Resend shows
  (10), or its SPF check stays *pending*.

## 5. Switch it on for a business

In `/platform`, open the business and tick **Email inbox**. Its Admin then opens
**Communication → Email → Settings → Email inbox address**.
- The Admin creates an address there, such as `harbour-cafe@inbox.meroidea.com`.
- They either publish it, or set their own support address to forward to it.
- Inbox permissions (`social.view`, `social.reply`, `social.manage`) apply to email exactly as to
  social media. A business can have email without social media, or the other way round.

## 6. How it behaves

- **Threads.**
  - Each new email starts a conversation.
  - A reply joins its thread when it is sent to that thread's own reply address (every reply from
    Meroidea sets it as Reply-To) or carries the thread's Message-IDs in `In-Reply-To` or
    `References`.
  - Either way it joins only when it comes from the thread's customer. A different sender starts
    a thread of their own, so nobody can write into someone else's conversation.
- **Words.**
  - The text part is kept; an HTML-only email is turned into plain text and shown as text, never
    as HTML.
  - The quoted history below a reply ("On … wrote:", "> …") is left out.
  - Over 20,000 characters is cut.
- **Contacts.**
  - A sender is linked to the contact with their email address only when their email passed
    **DKIM or DMARC**, as Resend reports it.
  - Otherwise the match is only offered to staff, and the message shows "Sender not verified".
    The From address of an email can be forged.
  - New leads for unknown senders follow the same rule, and are an opt-in per inbox.
- **Machine mail.** Auto-replies, bounces and mailing lists (Auto-Submitted, Precedence, List-Id
  and similar headers, or senders such as mailer-daemon and no-reply) are kept, but never become
  a lead or open a ticket.
- **Attachments.**
  - Customers' files are copied into the private `social-media` bucket from Resend's short-lived
    links, at most ten per email, under the same type and size rules as other channels.
  - Replies can attach one image, PDF or Office file up to 10 MB.
- **Limits.** One sender can put at most 60 emails an hour into one inbox, and an inbox takes at
  most 2,000 an hour; anything beyond is dropped.
- **Tickets.** An email conversation can become a helpdesk ticket like any other (ADR-069).
  Replies written on the ticket are emailed on the thread.

## 7. Not done yet

- Sending from a business's own domain (e.g. `support@harbourcafe.com.au`). That needs the
  business's domain verified in Resend; replies come from the inbox address for now.
- Starting a new email to someone who has not written in first.
- Keeping the original HTML of a received email.
