import 'server-only';

import { hasPermission, type TenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';
import { hmac, sameSignature, signJwt } from '@/server/jwt';

import { DOCUMENT_FORMATS } from './formats';
import type { DocumentDetail } from './types';

/*
 * The link to the document editing server (OnlyOffice Document Server, ADR-030). The server
 * fetches the file from us, shows it in the person's browser, and posts the edited file back.
 * Everything exchanged is signed with a secret both sides hold, and the two endpoints it calls
 * are not open to anyone else.
 */

/** How long the editor has to fetch a file after the page is opened. */
const CONTENT_LINK_SECONDS = 10 * 60;

export type EditorSettings = {
  publicUrl: string;
  internalUrl: string;
  secret: string;
  appUrl: string;
};

/** The editing server's settings, or null when it has not been connected. */
export function editorSettings(): EditorSettings | null {
  const env = serverEnv();
  if (!env.ONLYOFFICE_URL || !env.ONLYOFFICE_JWT_SECRET) return null;
  const trim = (url: string) => url.replace(/\/+$/, '');
  return {
    publicUrl: trim(env.ONLYOFFICE_URL),
    internalUrl: trim(env.ONLYOFFICE_INTERNAL_URL ?? env.ONLYOFFICE_URL),
    secret: env.ONLYOFFICE_JWT_SECRET,
    appUrl: trim(env.APP_INTERNAL_URL ?? env.APP_URL),
  };
}

/** One editing session per saved version: everyone opening the same version edits together. */
export const sessionKey = (documentId: string, version: number) => `${documentId}-${version}`;

const contentMessage = (documentId: string, version: number, expires: number) =>
  `content.${documentId}.${version}.${expires}`;
const callbackMessage = (documentId: string) => `callback.${documentId}`;

export function contentUrl(settings: EditorSettings, documentId: string, version: number): string {
  const expires = Math.floor(Date.now() / 1000) + CONTENT_LINK_SECONDS;
  const signature = hmac(settings.secret, contentMessage(documentId, version, expires));
  return `${settings.appUrl}/api/documents/${documentId}/content?v=${version}&exp=${expires}&sig=${signature}`;
}

export function isValidContentLink(
  settings: EditorSettings,
  input: { documentId: string; version: number; expires: number; signature: string },
): boolean {
  if (!Number.isInteger(input.expires) || input.expires * 1000 < Date.now()) return false;
  const expected = hmac(
    settings.secret,
    contentMessage(input.documentId, input.version, input.expires),
  );
  return sameSignature(input.signature, expected);
}

export const callbackSignature = (settings: EditorSettings, documentId: string) =>
  hmac(settings.secret, callbackMessage(documentId));

/**
 * What the browser hands to the editor for one document. The whole configuration is signed, so
 * the editing server refuses one that was altered in the browser (to gain edit rights, say).
 */
export function buildEditorConfig(
  ctx: TenantContext,
  document: DocumentDetail,
  userName: string,
  settings: EditorSettings,
): { scriptUrl: string; config: Record<string, unknown> } {
  // A PDF is opened for filling in and annotating; the Office formats for full editing.
  const canEdit = hasPermission(ctx, 'files.edit');
  const config = {
    document: {
      fileType: document.extension,
      key: sessionKey(document.id, document.version),
      title: `${document.name}.${document.extension}`,
      url: contentUrl(settings, document.id, document.version),
      permissions: {
        edit: canEdit,
        download: true,
        print: true,
        comment: canEdit,
        fillForms: canEdit,
      },
    },
    documentType: DOCUMENT_FORMATS[document.extension].editor,
    editorConfig: {
      mode: canEdit ? 'edit' : 'view',
      lang: 'en',
      callbackUrl: `${settings.appUrl}/api/documents/callback?id=${document.id}&sig=${callbackSignature(settings, document.id)}`,
      user: { id: ctx.userId, name: userName },
      // Saved back to the library once the last person closes the document, as one new version.
      customization: { autosave: true, forcesave: false, compactHeader: true },
    },
    height: '100%',
    width: '100%',
    type: 'desktop',
  };
  return {
    scriptUrl: `${settings.publicUrl}/web-apps/apps/api/documents/api.js`,
    config: { ...config, token: signJwt(config, settings.secret) },
  };
}
