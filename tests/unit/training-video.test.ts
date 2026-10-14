import { describe, expect, it } from 'vitest';

import { videoEmbedUrl } from '@/modules/training/video';

describe('playing a training video in the page', () => {
  it('plays YouTube from its privacy-enhanced address', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(videoEmbedUrl(url)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
  });

  it('plays Vimeo', () => {
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe(
      'https://player.vimeo.com/video/76979871',
    );
  });

  it('offers anything else as a link, and never embeds plain http or odd ids', () => {
    expect(videoEmbedUrl('https://example.com/video.mp4')).toBeNull();
    expect(videoEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=<script>')).toBeNull();
    expect(videoEmbedUrl('not a url')).toBeNull();
    expect(videoEmbedUrl(null)).toBeNull();
  });
});
