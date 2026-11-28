'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env.public';
import { startComposeUploadAction } from '@/modules/social/actions';

import { MAX_COMPOSE_FILE_BYTES } from '../schemas';

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Uploads one file to the writer's own Compose folder (ADR-090, ADR-091): a ticket for a path the
 * server chooses, then the bytes straight to storage. The server checks the file again when the
 * email is sent. Returns the path, or the reason it could not be uploaded.
 */
export async function uploadComposeFile(
  accountId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  const ticket = await startComposeUploadAction({
    accountId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  });
  if (!ticket.ok) return { error: ticket.error.message };
  const uploaded = await createBrowserClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
  )
    .storage.from('social-media')
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
  return uploaded.error
    ? { error: 'The upload did not finish. Try again.' }
    : { path: ticket.data.path };
}

/** A picture for the text: checked here first for a quick answer, then uploaded. */
export async function uploadComposePicture(
  accountId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  if (!PICTURE_TYPES.includes(file.type))
    return { error: 'Pictures can be JPEG, PNG, GIF or WebP.' };
  if (file.size > MAX_COMPOSE_FILE_BYTES) {
    return { error: `Pictures can be up to ${MAX_COMPOSE_FILE_BYTES / 1024 / 1024} MB.` };
  }
  return uploadComposeFile(accountId, file);
}
