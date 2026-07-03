import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './renderMarkdown.js';

describe('renderMarkdown', () => {
  it('renders safe Markdown to HTML', () => {
    const html = renderMarkdown('# Title\n\nHello **world** with a [link](https://example.com).');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('href="https://example.com"');
  });

  it('strips <script> tags', () => {
    const html = renderMarkdown('ok\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('strips class attributes so body content cannot pick up global app styles', () => {
    const html = renderMarkdown('<span class="mp-savebar">overlay</span>');
    expect(html).not.toContain('class=');
    expect(html).toContain('overlay');
  });

  it('keeps tables, code blocks and images', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n![alt](https://example.com/i.png)';
    const html = renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<img');
    expect(html).toContain('alt="alt"');
  });
});
