// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { focusableWithin, trapTab } from './useOverlay';

// happy-dom returns null from offsetParent for every element, which would hide all focusables from the
// visibility filter. Shim it so a connected element reports a parent (a genuine test-harness accommodation).
// Install in beforeAll and restore in afterAll — NOT at module scope, or the "restore" runs while the file is
// still loading and the shim leaks into other files' shared prototype (SHOULD-FIX 7).
const proto = Object.getPrototypeOf(document.createElement('div'));
const original = Object.getOwnPropertyDescriptor(proto, 'offsetParent');

beforeAll(() => {
  Object.defineProperty(proto, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.isConnected ? document.body : null;
    },
  });
});

afterAll(() => {
  // Restore the ORIGINAL state exactly: re-install the real descriptor if there was one, otherwise DELETE the
  // shim so a prototype that never had an own `offsetParent` descriptor is left without one (SHOULD-FIX 7).
  if (original) Object.defineProperty(proto, 'offsetParent', original);
  else delete (proto as Record<string, unknown>).offsetParent;
});

afterEach(() => {
  document.body.innerHTML = '';
});

function panelWith(html: string): HTMLElement {
  const panel = document.createElement('div');
  panel.tabIndex = -1;
  panel.innerHTML = html;
  document.body.appendChild(panel);
  return panel;
}

describe('focusableWithin', () => {
  it('returns the enabled, visible focusables in DOM order and skips disabled ones', () => {
    const panel = panelWith('<button id="a">a</button><button id="b" disabled>b</button><a id="c" href="#">c</a>');
    expect(focusableWithin(panel).map((el) => el.id)).toEqual(['a', 'c']);
  });

  it('returns [] for a null panel', () => {
    expect(focusableWithin(null)).toEqual([]);
  });
});

describe('trapTab', () => {
  it('wraps forward Tab from the last focusable back to the first (preventDefault + focus first)', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    const [first, last] = focusableWithin(panel);
    last.focus();
    let prevented = false;
    trapTab(panel, { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps backward Shift+Tab from the first focusable to the last', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    const [first, last] = focusableWithin(panel);
    first.focus();
    let prevented = false;
    trapTab(panel, { key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('with no focusables, keeps focus on the panel itself', () => {
    const panel = panelWith('<span>text only</span>');
    let prevented = false;
    trapTab(panel, { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(panel);
  });
});
