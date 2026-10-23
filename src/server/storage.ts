import 'server-only';

import { AppError } from '@/lib/errors';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

/**
 * The private `documents` bucket. It has no storage policies, so nothing reaches it except
 * through these functions, and callers must have checked the person's permission first
 * (.claude/rules/security.md, Files). Paths are always chosen by the server.
 */
const BUCKET = 'documents';
const bucket = () => createSupabaseAdminClient().storage.from(BUCKET);

export async function createUploadTicket(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new AppError('INTERNAL', 'Could not prepare the upload.');
  return { path: data.path, token: data.token };
}

/** The whole object, or null when nothing is stored at that path. */
export async function readObject(path: string): Promise<Buffer | null> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function writeObject(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
  if (error) throw new AppError('INTERNAL', 'Could not store the file.');
}

export async function removeObject(path: string): Promise<void> {
  await bucket().remove([path]);
}

/** Removes many objects, in batches the storage API accepts; returns how many went. */
export async function removeObjects(paths: string[]): Promise<number> {
  let removed = 0;
  for (let start = 0; start < paths.length; start += 100) {
    const { data, error } = await bucket().remove(paths.slice(start, start + 100));
    if (!error) removed += data?.length ?? 0;
  }
  return removed;
}

/** A link that downloads the object under a given file name, valid for one minute. */
export async function createDownloadUrl(path: string, fileName: string): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, 60, { download: fileName });
  if (error || !data) throw new AppError('INTERNAL', 'Could not prepare the download.');
  return data.signedUrl;
}
