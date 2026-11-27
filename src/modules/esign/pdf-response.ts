import 'server-only';

/**
 * A PDF answered straight from the server, never cached, framed or sniffed as anything else.
 * `download` asks the browser to save it under its name instead of showing it.
 */
export function pdfResponse(
  file: { bytes: Buffer; fileName: string },
  download: boolean,
): Response {
  const safeName = file.fileName.replace(/["\\\r\n]/g, '').slice(0, 180) || 'document.pdf';
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export const notFound = () => new Response('Not found', { status: 404 });
