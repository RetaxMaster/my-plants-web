import { describe, expect, it } from 'vitest';
import { renderArticle } from './renderArticle.js';

describe('renderArticle — heading ids', () => {
  it('adds slugified ids to h2 and h3', () => {
    const { html } = renderArticle('## Watering basics\n\n### When to water');
    expect(html).toContain('<h2 id="watering-basics">Watering basics</h2>');
    expect(html).toContain('<h3 id="when-to-water">When to water</h3>');
  });

  it('deduplicates repeated heading slugs', () => {
    const { html, toc } = renderArticle('## Setup\n\ntext\n\n## Setup');
    expect(html).toContain('id="setup"');
    expect(html).toContain('id="setup-1"');
    expect(toc.map((t) => t.id)).toEqual(['setup', 'setup-1']);
  });

  it('does NOT add ids to h1 or h4 (not TOC-eligible)', () => {
    const { html } = renderArticle('# Title\n\n#### Aside');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h4>Aside</h4>');
  });
});

describe('renderArticle — TOC extraction', () => {
  it('lists h2/h3 in document order with levels and plain text', () => {
    const { toc } = renderArticle('## Light\n\n### Direct **sun**\n\n## Water');
    expect(toc).toEqual([
      { id: 'light', text: 'Light', level: 2 },
      { id: 'direct-sun', text: 'Direct sun', level: 3 },
      { id: 'water', text: 'Water', level: 2 },
    ]);
  });

  it('is empty when the body has no h2/h3', () => {
    const { toc } = renderArticle('Just a paragraph with **bold** text.');
    expect(toc).toEqual([]);
  });
});

describe('renderArticle — scoped sanitizer (id only on h2/h3, and only OUR ids)', () => {
  it('strips id off non-heading tags (author-supplied <span id>)', () => {
    const { html } = renderArticle('<span id="mp-savebar">x</span>');
    expect(html).not.toContain('id="mp-savebar"');
    expect(html).toContain('x');
  });

  it('strips an author-supplied id on raw <h2>/<h3> HTML (not one we generated)', () => {
    // The riskiest case: literal heading HTML in the body carrying an id that could collide with the
    // page's fixed .mp-* ids. The node IS an h2, but "mp-savebar" is not in our generated-id set.
    const { html } = renderArticle('<h2 id="mp-savebar">x</h2>\n\n<h3 id="mp-topbar">y</h3>');
    expect(html).not.toContain('id="mp-savebar"');
    expect(html).not.toContain('id="mp-topbar"');
    expect(html).toContain('x');
    expect(html).toContain('y');
  });

  it('still strips class attributes (ban unchanged)', () => {
    const { html } = renderArticle('<span class="mp-savebar">x</span>');
    expect(html).not.toContain('class=');
  });

  it('still strips javascript: URLs and event handlers', () => {
    expect(renderArticle('[x](javascript:alert(1))').html).not.toContain('javascript:');
    expect(renderArticle('<img src="x" onerror="alert(1)">').html).not.toContain('onerror');
  });
});
