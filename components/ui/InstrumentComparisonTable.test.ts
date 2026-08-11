// @vitest-environment happy-dom
//
// QA round 5, F4 — three weaknesses in the /settings instrument comparison table on a 390x844 screen, all
// in this one component. It had NO test file at all before this round, which is how all three shipped:
//   1. the right-edge scroll hint did not clear at maximum scroll, so the affordance stopped telling the
//      truth about position;
//   2. the caption paragraph lived INSIDE the scroller and slid out of view with the table it explains;
//   3. the row-header column was not sticky, so scrolled to the answers the owner read `No / Sí / No / No`
//      with nothing saying which instrument each row was — and in Spanish the at-rest cut landed exactly on
//      a column boundary, making the table look like it genuinely had two columns.
//
// What a DOM test can and cannot see is drawn honestly here: (2) and the STRUCTURE half of (1) are real DOM
// facts and are asserted as such; (3) and the paint half of (1) are CSS, asserted through the one thing the
// component actually decides — the state class — with the declarations themselves verified in a real
// browser (see the ledger, QA round 5 / F4).
import { describe, it, expect, vi } from 'vitest';
import { ref, computed, watch, onMounted } from 'vue';
import { mount } from '@vue/test-utils';
import InstrumentComparisonTable from './InstrumentComparisonTable.vue';
import type { InstrumentRow } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('onMounted', onMounted);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

const rows = [
  {
    id: 'galvanic-probe', kind: 'moisture', unit: 'index', scale: 'probe-1-to-10',
    direction: 'higher-is-wetter', comparableAcrossPots: false, requiresCalibration: false,
    protocolKind: 'insertion', captureKind: 'numeric', rawMin: 1, rawMax: 10, rawStep: 1,
  },
  {
    id: 'kitchen-scale', kind: 'mass', unit: 'g', scale: 'grams',
    direction: 'higher-is-wetter', comparableAcrossPots: true, requiresCalibration: true,
    protocolKind: 'whole-pot', captureKind: 'numeric', rawMin: 0, rawMax: null, rawStep: 1,
  },
] as unknown as InstrumentRow[];

// happy-dom reports `0` for every layout metric, so the component's own measurement is a genuine "nothing
// overflows" reading unless a test says otherwise. These helpers say otherwise — they describe the REAL
// geometry QA measured at 390 px: 585 px of content in a 312 px box, 273 px of travel.
function setGeometry(el: Element, { scrollLeft }: { scrollLeft: number }) {
  Object.defineProperty(el, 'clientWidth', { value: 312, configurable: true });
  Object.defineProperty(el, 'scrollWidth', { value: 585, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true });
}

function mountTable() {
  return mount(InstrumentComparisonTable, { props: { rows } });
}

describe('UiInstrumentComparisonTable — F4.2: the caption is not a column', () => {
  // ⚠️ THE STRUCTURAL HALF, AND THE ONE A LATER "TIDY-UP" WOULD UNDO. The note used to be a sibling of the
  // table INSIDE the overflow container, so it scrolled horizontally with it: the one sentence explaining
  // why a cheap probe is still useful was reachable only by scrolling away from the columns it is about.
  // Moving it back inside turns this RED.
  it('renders the caption OUTSIDE the horizontal scroller', () => {
    const w = mountTable();
    const scroller = w.find('.mp-instrtable__scroll');
    const note = w.find('.mp-instrtable__note');
    expect(scroller.exists()).toBe(true);
    expect(note.exists()).toBe(true);
    expect(scroller.element.contains(note.element)).toBe(false);
  });

  // ...and the table is still inside it. A "fix" that took the overflow container away entirely would pass
  // the case above and hand the page body a horizontal scrollbar, which is the project's own rule broken.
  it('keeps the table itself inside the scroller', () => {
    const w = mountTable();
    const scroller = w.find('.mp-instrtable__scroll');
    expect(scroller.element.contains(w.find('table').element)).toBe(true);
  });
});

describe('UiInstrumentComparisonTable — F4.1: the scroll hint tells the truth about position', () => {
  it('offers the hint while there is still something to the right', async () => {
    const w = mountTable();
    const scroller = w.find('.mp-instrtable__scroll');
    setGeometry(scroller.element, { scrollLeft: 0 });
    await scroller.trigger('scroll');
    expect(scroller.classes()).toContain('mp-instrtable__scroll--more');
  });

  // ⚠️ THE MEASURED DEFECT. QA set `scrollLeft = 9999` and the hint was still drawn. Deleting the class
  // binding (hint always on) turns this RED; inverting the predicate turns the case above RED.
  it('DROPS the hint at maximum scroll', async () => {
    const w = mountTable();
    const scroller = w.find('.mp-instrtable__scroll');
    setGeometry(scroller.element, { scrollLeft: 0 });
    await scroller.trigger('scroll');
    expect(scroller.classes()).toContain('mp-instrtable__scroll--more');

    setGeometry(scroller.element, { scrollLeft: 9999 });
    await scroller.trigger('scroll');
    expect(scroller.classes()).not.toContain('mp-instrtable__scroll--more');
  });

  // `/settings` mounts this component before its instrument list has loaded, so the FIRST measurement is
  // always taken on an empty table and would leave the hint off forever. Deleting the `rows` watcher turns
  // this RED.
  it('re-measures when the row set arrives', async () => {
    const w = mount(InstrumentComparisonTable, { props: { rows: [] as InstrumentRow[] } });
    const scroller = w.find('.mp-instrtable__scroll');
    expect(scroller.classes()).not.toContain('mp-instrtable__scroll--more');

    setGeometry(scroller.element, { scrollLeft: 0 });
    await w.setProps({ rows });
    expect(scroller.classes()).toContain('mp-instrtable__scroll--more');
  });
});

describe('UiInstrumentComparisonTable — F4.3: the instrument name is the row header', () => {
  // The sticky pin is CSS, but WHICH cell it applies to is markup, and that is what a rename would break:
  // the stylesheet pins `th[scope=row]`, so a row whose first cell became a `<td>` would silently scroll
  // away again with no failing test anywhere.
  it('keeps the instrument name in a `th[scope=row]`, which is what the sticky rule pins', () => {
    const w = mountTable();
    const headers = w.findAll('tbody th[scope="row"]');
    expect(headers).toHaveLength(rows.length);
    expect(headers[0]!.text()).toBe('settings.instruments.name.galvanic-probe');
  });
});
