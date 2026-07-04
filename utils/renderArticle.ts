import { Marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { slugify } from '@retaxmaster/my-plants-species-schema';

// A NEW render helper for the PUBLIC article (the editor preview keeps the unchanged, stricter
// `renderMarkdown`). It differs in exactly two ways: it (1) emits `id` on h2/h3 so the TOC/scroll-spy
// can anchor to them, and (2) returns the TOC extracted from the SAME headings so the anchors and the
// index can never drift. The TOC is built from the Markdown source, so it is deterministic in SSR and
// on the client (isomorphic — no client-only TOC, no CLS).

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}
export interface RenderedArticle {
  html: string;
  toc: TocEntry[];
}

// Same tag policy as renderMarkdown, PLUS `id` — but `id` is then constrained to h2/h3 by the scoped
// hook below (see the sanitize call). `class` stays forbidden (body content must not grab .mp-*
// fixed/overlay classes).
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'del', 'code', 'pre', 'hr', 'br', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
];
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'colspan', 'rowspan', 'align', 'id'];

// Strip inline Markdown markers so a heading like `Direct **sun**` becomes a clean TOC label.
// Deterministic and DOM-free (runs identically in SSR and the browser).
function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) / ![alt](src) -> label/alt
    .replace(/[*_`~]/g, '')                    // emphasis / inline-code / strikethrough markers
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderArticle(md: string): RenderedArticle {
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();
  // The EXACT set of ids WE generated on real Markdown headings this render. The sanitizer hook keeps
  // `id` only when its value is in here — so an author who writes literal `<h2 id="mp-savebar">` HTML
  // in the body has that id STRIPPED (it is not one of ours), even though the node is an h2. This is
  // the spec invariant: "the kept ids are our slugify output on the heading text, not attacker markup."
  const generatedIds = new Set<string>();

  // Deduplicate slugs: the first "setup" stays `setup`, the next becomes `setup-1`, etc. An empty
  // slug (heading with no slug-able chars) falls back to `section`.
  const dedupe = (base: string): string => {
    const key = base || 'section';
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    return n === 0 ? key : `${key}-${n}`;
  };

  // Fresh instance per call so the captured `toc`/`used` never leak across renders (no shared state).
  const marked = new Marked({
    renderer: {
      heading(token) {
        const depth = token.depth;
        const inner = this.parser.parseInline(token.tokens);
        if (depth === 2 || depth === 3) {
          const id = dedupe(slugify(token.text));
          generatedIds.add(id);
          toc.push({ id, text: plainText(token.text), level: depth as 2 | 3 });
          return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
        }
        return `<h${depth}>${inner}</h${depth}>\n`;
      },
    },
  });

  const rawHtml = marked.parse(md, { async: false }) as string;

  // SCOPED sanitizer hook: `id` is in ALLOWED_ATTR above (so DOMPurify lets it reach the hook), and
  // this hook DROPS it unless BOTH hold: (a) the node is an H2/H3, AND (b) the id value is one WE
  // generated this render (`generatedIds`). Condition (b) is what defeats author-/attacker-supplied
  // ids on raw `<h2 id="…">`/`<h3 id="…">` HTML in the body — those are not in the set, so they are
  // stripped and can never collide with the page's fixed `.mp-*`/anchor ids. Added and removed around
  // the single sanitize call so renderMarkdown (the editor preview) is never affected. Synchronous,
  // no reentrancy — `generatedIds` is fully populated by the parse pass above before sanitize runs.
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'id') return;
    const isHeading = node.nodeName === 'H2' || node.nodeName === 'H3';
    if (!isHeading || !generatedIds.has(data.attrValue)) {
      data.keepAttr = false;
    }
  });
  let html: string;
  try {
    html = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
  }

  return { html, toc };
}
