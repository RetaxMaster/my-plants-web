import { describe, expect, it } from 'vitest';
import { needsThumbnailWarning } from './publishGuard.js';

describe('needsThumbnailWarning', () => {
  it('warns when the ES body still contains the thumbnail-prompt block', () => {
    const body = '<!-- THUMBNAIL-PROMPT\nGenerate a cover…\nTHUMBNAIL-PROMPT -->\n\n# Real content';
    expect(needsThumbnailWarning(body)).toBe(true);
  });
  it('does not warn on a clean body', () => {
    expect(needsThumbnailWarning('# Clean post\n\nNo prompt here.')).toBe(false);
  });
  it('does not warn on null/empty', () => {
    expect(needsThumbnailWarning(null)).toBe(false);
    expect(needsThumbnailWarning('')).toBe(false);
  });
});
