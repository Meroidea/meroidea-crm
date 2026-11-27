import { FileText } from 'lucide-react';

import { storyLabel } from '../channel-conventions';
import type { StoredAttachment } from '../media';

/** A photo, video, voice note, file or story in a message, served through `/api/social/media`. */
export function Attachment({
  messageId,
  index,
  attachment,
  platformLabel,
}: {
  messageId: string;
  index: number;
  attachment: StoredAttachment;
  platformLabel: string;
}) {
  const story = storyLabel(attachment.type);
  if (story) {
    return (
      <span className="flex flex-col gap-1">
        <span className="text-xs font-medium opacity-80">{story}</span>
        {attachment.state === 'stored' || attachment.state === 'pending' ? (
          <Attachment
            messageId={messageId}
            index={index}
            attachment={{ ...attachment, type: 'story' }}
            platformLabel={platformLabel}
          />
        ) : (
          <span className="text-xs opacity-80">The story is no longer available.</span>
        )}
      </span>
    );
  }
  const src = `/api/social/media/${messageId}/${index}`;
  if (attachment.state === 'stored') {
    const mime = attachment.mimeType ?? '';
    if (mime.startsWith('image/')) {
      return (
        <a href={src} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a one-minute signed redirect per request; nothing for the image optimiser to cache */}
          <img
            src={src}
            alt={`${attachment.type} sent by the customer`}
            loading="lazy"
            className="max-h-64 max-w-full rounded-lg object-contain"
          />
        </a>
      );
    }
    if (mime.startsWith('video/')) {
      return (
        <video controls preload="metadata" src={src} className="max-h-72 max-w-full rounded-lg" />
      );
    }
    if (mime.startsWith('audio/'))
      return <audio controls preload="metadata" src={src} className="max-w-full" />;
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-4"
      >
        <FileText aria-hidden className="size-4" /> Open the file
      </a>
    );
  }
  if (attachment.state === 'pending') {
    return <span className="text-xs opacity-80">Saving the {attachment.type}…</span>;
  }
  return (
    <span className="text-xs opacity-80">
      {attachment.type === 'sticker' ? 'A sticker' : `A ${attachment.type}`} that could not be saved
      {attachment.url ? (
        <>
          {' '}
          ·{' '}
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            open on {platformLabel}
          </a>
        </>
      ) : null}
    </span>
  );
}
