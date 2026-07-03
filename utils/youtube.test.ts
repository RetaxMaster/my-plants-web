import { describe, expect, it } from 'vitest';
import { youtubeId, youtubeEmbedUrl } from './youtube.js';

describe('youtubeId', () => {
  it('extracts the id from a watch URL', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts the id from a short youtu.be URL', () => {
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts the id from an embed and a shorts URL', () => {
    expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('returns null for null/empty/non-youtube input', () => {
    expect(youtubeId(null)).toBeNull();
    expect(youtubeId('')).toBeNull();
    expect(youtubeId('https://example.com/watch?v=nope')).toBeNull();
  });
});

describe('youtubeEmbedUrl', () => {
  it('builds a privacy (nocookie) embed URL', () => {
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });
  it('returns null when there is no id', () => {
    expect(youtubeEmbedUrl('https://example.com')).toBeNull();
  });
});
