import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

// Blogpost bodies are now authored through the UI (admins) and edited freely, so the old
// "trusted, never user-supplied" assumption no longer holds. We render Markdown -> HTML with
// `marked`, then SANITISE the HTML with DOMPurify BEFORE it reaches `v-html`/<UiProse>. One shared
// implementation used by BOTH the public article and the editor preview (so preview == published,
// and the sanitiser can never diverge between the two). isomorphic-dompurify runs under Node during
// SSR and in the browser on the client.
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'del', 'code', 'pre', 'hr', 'br', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
];
// `class` is intentionally NOT allowed: the app's global classes (e.g. `.mp-savebar` is `position:
// fixed`, `.mp-pagenum` etc. in chrome.css) would let body content pick up fixed/overlay styling and
// visually hijack the page. UiProse styles the article via its own `.mp-prose` wrapper, so inner
// class hooks are never needed.
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'colspan', 'rowspan', 'align'];

export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(md, { async: false }) as string;
  // FORBID_ATTR drops event handlers / inline styles; the default DOMPurify URI policy already
  // strips `javascript:` (and other dangerous schemes) from href/src.
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  });
}
