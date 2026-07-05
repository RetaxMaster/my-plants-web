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
  // Display index for the TOC: a zero-padded section number for h2 ("01", "02", …), a middot "·" for
  // h3 sub-entries. Computed here (from document order) so the index and anchors never drift.
  num: string;
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
  let sectionNum = 0; // increments on each h2 → the TOC's "01", "02", … section numbering
  // The EXACT set of ids WE generated on real Markdown headings this render. The sanitizer hook keeps
  // `id` only when its value is in here — so an author who writes literal `<h2 id="mp-savebar">` HTML
  // in the body has that id STRIPPED (it is not one of ours), even though the node is an h2. This is
  // the spec invariant: "the kept ids are our slugify output on the heading text, not attacker markup."
  const generatedIds = new Set<string>();

  // Per-render UNGUESSABLE nonce. Our heading renderer prefixes every id it emits with `${nonce}:`; the
  // sanitizer hook keeps an id ONLY when it carries this prefix (then strips it back off). Value-only
  // matching is NOT enough: raw author HTML like `<h2 id="watering-basics">` can COLLIDE with a slug we
  // also generated for a real `## Watering basics`, and a value check would let the injected id survive
  // (duplicate id / hijacked TOC anchor). The author cannot forge a random per-render prefix, so their
  // id is dropped. The nonce never reaches the returned html (stripped in the hook), so the final ids
  // are the clean slugs — identical in SSR and on the client (no hydration mismatch).
  const nonce = `mp-h-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

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
          if (depth === 2) sectionNum += 1;
          const num = depth === 2 ? String(sectionNum).padStart(2, '0') : '·';
          toc.push({ id, text: plainText(token.text), level: depth as 2 | 3, num });
          // Emit the nonce-prefixed id; the hook strips the prefix back to the clean `id` after proving
          // provenance. The clean `id` is what lands in the html and the toc, so the two never drift.
          return `<h${depth} id="${nonce}:${id}">${inner}</h${depth}>\n`;
        }
        return `<h${depth}>${inner}</h${depth}>\n`;
      },
    },
  });

  const rawHtml = marked.parse(md, { async: false }) as string;

  // SCOPED sanitizer hook: `id` is in ALLOWED_ATTR above (so DOMPurify lets it reach the hook), and
  // this hook DROPS it unless ALL hold: (a) the node is an H2/H3, (b) the id carries THIS render's
  // unguessable `${nonce}:` prefix (proving WE emitted it — an author cannot forge it, so a raw
  // `<h2 id="watering-basics">` that collides with a real slug is still dropped), and (c) the stripped
  // slug is one we actually generated (`generatedIds`, belt-and-suspenders). When kept, the nonce
  // prefix is removed so the surviving `id` is the clean slug. Added and removed around the single
  // sanitize call so renderMarkdown (the editor preview) is never affected. Synchronous, no reentrancy
  // — `generatedIds` is fully populated by the parse pass above before sanitize runs.
  const prefix = `${nonce}:`;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'id') return;
    const isHeading = node.nodeName === 'H2' || node.nodeName === 'H3';
    if (isHeading && data.attrValue.startsWith(prefix)) {
      const clean = data.attrValue.slice(prefix.length);
      if (generatedIds.has(clean)) {
        data.attrValue = clean; // strip the nonce; keep our real slug id
        return;
      }
    }
    data.keepAttr = false; // any id without our per-render nonce (incl. raw author ids) is dropped
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
