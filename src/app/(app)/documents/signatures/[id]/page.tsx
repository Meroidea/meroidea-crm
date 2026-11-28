import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { signerColour } from '@/modules/esign/colours';
import { FIELD_KIND_LABELS } from '@/modules/esign/geometry';
import { PreviewWithFields } from '@/modules/esign/components/preview-with-fields';
import {
  DownloadSignedButton,
  ResendLinkButton,
  VoidRequestButton,
} from '@/modules/esign/components/request-actions';
import { RequestEditor } from '@/modules/esign/components/request-editor';
import { RequestStatusBadge } from '@/modules/esign/components/status-badge';
import { getSignRequest } from '@/modules/esign/queries';
import { signersWhoseTurnItIs } from '@/modules/esign/rules';
import { requestIdSchema } from '@/modules/esign/schemas';
import type { EventView } from '@/modules/esign/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Signature request' };

function describe(event: EventView): string {
  const who = event.signerName ?? 'A signer';
  switch (event.event) {
    case 'created':
      return `${event.actorName ?? 'Someone'} started the request`;
    case 'sent':
      return `${event.actorName ?? 'Someone'} sent it for signature`;
    case 'invited':
      return `Signing link sent to ${who}`;
    case 'code_sent':
      return `One-time code emailed to ${who}`;
    case 'verified':
      return `${who} entered the right code`;
    case 'viewed':
      return `${who} opened the document`;
    case 'signed':
      return `${who} signed`;
    case 'declined':
      return `${who} declined`;
    case 'voided':
      return `${event.actorName ?? 'Someone'} voided the request`;
    case 'completed':
      return 'Everyone signed; the signed copy was made';
    default:
      return event.event;
  }
}

export default async function SignatureRequestPage({
  params,
}: PageProps<'/documents/signatures/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'files.request_signatures');
  const parsed = requestIdSchema.safeParse(await params);
  const request = parsed.success ? await getSignRequest(ctx, parsed.data.id) : null;
  if (!request) notFound();

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <Link href="/documents" className="underline-offset-4 hover:underline">
        Documents
      </Link>{' '}
      /{' '}
      <Link href="/documents/signatures" className="underline-offset-4 hover:underline">
        Signatures
      </Link>{' '}
      / {request.title}
    </nav>
  );

  if (request.status === 'draft') {
    return (
      <div className="flex w-full max-w-7xl flex-col gap-5">
        <div>
          {breadcrumb}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Prepare for signature</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            From{' '}
            <Link
              href={`/documents/${request.documentId}`}
              className="underline underline-offset-4"
            >
              {request.documentName}
            </Link>
            , version {request.documentVersion}. Add the signers, place their fields, then send.
          </p>
        </div>
        <RequestEditor request={request} />
      </div>
    );
  }

  const turn = new Set(
    request.status === 'sent' && !request.expired
      ? signersWhoseTurnItIs(request.signers, request.signingOrder).map((signer) => signer.id)
      : [],
  );

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <div>
        {breadcrumb}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{request.title}</h1>
              <RequestStatusBadge status={request.status} expired={request.expired} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Sent {formatDateTime(ctx, request.sentAt)}
              {request.sentByName ? ` by ${request.sentByName}` : ''} ·{' '}
              {request.signingOrder === 'sequential' ? 'One after another' : 'Everyone at once'} ·{' '}
              {request.verifyEmail ? 'Emailed code required' : 'Link only'}
              {request.expiresAt && request.status === 'sent'
                ? ` · ${request.expired ? 'Expired' : 'Open until'} ${formatDateTime(ctx, request.expiresAt)}`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {request.status === 'completed' && <DownloadSignedButton requestId={request.id} />}
            {request.status === 'sent' && <VoidRequestButton requestId={request.id} />}
          </div>
        </div>
      </div>

      {request.status === 'voided' && (
        <p className="rounded-lg border bg-muted px-4 py-3 text-sm">
          Voided {formatDateTime(ctx, request.voidedAt)}. Note to signers: {request.voidReason}
        </p>
      )}

      <section aria-label="Signers" className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-medium">Signers</h2>
        </header>
        <ol className="divide-y">
          {request.signers.map((signer, index) => (
            <li key={signer.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span
                aria-hidden
                className={cn('size-3 shrink-0 rounded-full border-2', signerColour(index))}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {request.signingOrder === 'sequential' ? `${signer.position}. ` : ''}
                  {signer.name}
                </span>
                <span className="block text-xs break-all text-muted-foreground">
                  {signer.email}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {signer.status === 'signed'
                    ? `Signed ${formatDateTime(ctx, signer.signedAt)}`
                    : signer.status === 'declined'
                      ? `Declined ${formatDateTime(ctx, signer.declinedAt)}: “${signer.declineReason}”`
                      : signer.viewedAt
                        ? `Opened ${formatDateTime(ctx, signer.viewedAt)}, not signed yet`
                        : signer.invitedAt
                          ? `Invited ${formatDateTime(ctx, signer.invitedAt)}, not opened yet`
                          : 'Waiting for their turn'}
                </span>
              </span>
              {turn.has(signer.id) && (
                <ResendLinkButton requestId={request.id} signerId={signer.id} name={signer.name} />
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label="Document" className="min-w-0">
          <h2 className="mb-2 text-sm font-medium">
            Document{' '}
            <span className="font-normal text-muted-foreground">
              as sent ·{' '}
              <Link
                href={`/documents/${request.documentId}`}
                className="underline underline-offset-4"
              >
                {request.documentName}
              </Link>{' '}
              version {request.documentVersion}
            </span>
          </h2>
          <PreviewWithFields
            requestId={request.id}
            fields={request.fields.map((field) => ({
              ...field,
              colour: signerColour(
                request.signers.findIndex((signer) => signer.id === field.signerId),
              ),
              label: field.label || FIELD_KIND_LABELS[field.kind],
            }))}
          />
        </section>

        <aside className="flex flex-col gap-5">
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-sm font-medium">History</h2>
            <ol className="mt-3 flex flex-col gap-2.5">
              {request.events.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="block">{describe(event)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(ctx, event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border bg-card p-4 text-xs">
            <h2 className="text-sm font-medium">Fingerprints (SHA-256)</h2>
            <p className="mt-2 text-muted-foreground">Original, as sent</p>
            <p className="font-mono break-all">{request.originalSha256}</p>
            {request.signedSha256 && (
              <>
                <p className="mt-2 text-muted-foreground">Signed copy</p>
                <p className="font-mono break-all">{request.signedSha256}</p>
                <p className="mt-2 text-muted-foreground">
                  Anyone can check a copy at{' '}
                  <Link href="/verify" className="underline underline-offset-4">
                    /verify
                  </Link>
                  .
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
