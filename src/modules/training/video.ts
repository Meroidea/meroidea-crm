/**
 * The address to play a training video inside the page, for the services that allow it, or null
 * to offer the link instead. YouTube plays from its privacy-enhanced domain. Pure; safe anywhere.
 */
export function videoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const id = (value: string | null | undefined) =>
    value && /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : null;

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, rest] = parsed.pathname.split('/');
    const video =
      parsed.pathname === '/watch'
        ? id(parsed.searchParams.get('v'))
        : kind === 'embed' || kind === 'shorts' || kind === 'live'
          ? id(rest)
          : null;
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === 'youtu.be') {
    const video = id(parsed.pathname.slice(1));
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const video = parsed.pathname.split('/').filter(Boolean).pop();
    return video && /^\d{4,12}$/.test(video) ? `https://player.vimeo.com/video/${video}` : null;
  }
  return null;
}
