// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ChangeList from './ChangeList.vue';
import type { DoctorProposalChange } from '../../types/api';

function mountList(changes: DoctorProposalChange[]) {
  return mount(ChangeList, {
    props: { changes, emptyValue: 'EMPTY', staleLabel: 'STALE:' },
    global: { stubs: { AppIcon: true } },
  });
}

describe('UiChangeList', () => {
  it('renders field, current value and proposed value', () => {
    const w = mountList([{ field: 'Pot type', before: 'Plastic', after: 'Terracotta' }]);
    expect(w.text()).toContain('Pot type');
    expect(w.text()).toContain('Plastic');
    expect(w.text()).toContain('Terracotta');
  });

  it('renders the empty placeholder for a null before and a null after (a clear)', () => {
    const w = mountList([{ field: 'Nickname', before: null, after: null }]);
    expect(w.findAll('.mp-changes__before')[0].text()).toBe('EMPTY');
    expect(w.findAll('.mp-changes__after')[0].text()).toBe('EMPTY');
  });

  // Spec §5.5.3: the LIVE value is what the owner sees as current; the snapshot is disclosed as history.
  // Rendering the stale snapshot as if it were current is exactly what the spec forbids.
  it('shows the stale disclosure with the value the agent originally saw', () => {
    const w = mountList([
      { field: 'Pot size', before: '18', after: '22', stale: { atProposeTime: '14' } },
    ]);
    const stale = w.find('.mp-changes__stale');
    expect(stale.exists()).toBe(true);
    expect(stale.text()).toContain('STALE:');
    expect(stale.text()).toContain('14');
    expect(w.find('.mp-changes__before').text()).toBe('18');
  });

  it('renders no stale line when the value did not drift', () => {
    const w = mountList([{ field: 'Pot size', before: '18', after: '22' }]);
    expect(w.find('.mp-changes__stale').exists()).toBe(false);
  });

  // A drift TO no value at all is still a drift. `atProposeTime: null` is meaningfully different from an
  // absent `stale`, so it must render the disclosure with the empty placeholder rather than silently
  // dropping the line and implying nothing changed underneath.
  it('discloses a drift whose earlier value was empty', () => {
    const w = mountList([
      { field: 'Nickname', before: 'Randy', after: 'Rand', stale: { atProposeTime: null } },
    ]);
    const stale = w.find('.mp-changes__stale');
    expect(stale.exists()).toBe(true);
    expect(stale.text()).toContain('EMPTY');
  });

  // The browser formats NO domain value. Whatever the server sent is what the owner sees — this test is
  // the guard against a well-meaning later "improvement" that title-cases, truncates or unit-suffixes a
  // value on its way to the screen, which would make the consent surface disagree with the write.
  it('renders server strings verbatim, without reformatting', () => {
    const w = mountList([
      { field: 'Every (days)', before: 'no-CAPS_change 7', after: '  spaced  ', stale: undefined },
    ]);
    expect(w.find('.mp-changes__before').text()).toBe('no-CAPS_change 7');
    // .text() trims, so assert on the raw DOM to prove nothing was rewritten en route.
    expect(w.find('.mp-changes__after').element.textContent).toBe('  spaced  ');
  });

  it('renders one row per change, in server order', () => {
    const w = mountList([
      { field: 'A', before: '1', after: '2' },
      { field: 'B', before: '3', after: '4' },
    ]);
    const rows = w.findAll('.mp-changes__row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('A');
    expect(rows[1].text()).toContain('B');
  });

  // Two changes can legitimately share a field label within one operation; keying on the label alone
  // would make Vue reuse the wrong node.
  it('renders duplicate field labels as separate rows', () => {
    const w = mountList([
      { field: 'Tags', before: 'a', after: 'b' },
      { field: 'Tags', before: 'c', after: 'd' },
    ]);
    expect(w.findAll('.mp-changes__row')).toHaveLength(2);
    expect(w.text()).toContain('a');
    expect(w.text()).toContain('d');
  });

  it('renders an empty list without failing', () => {
    const w = mountList([]);
    expect(w.findAll('.mp-changes__row')).toHaveLength(0);
  });
});
