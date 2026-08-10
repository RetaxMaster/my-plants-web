// @vitest-environment happy-dom
//
// Harness mirrors SegmentedControl.test.ts / SoilReadingModal.test.ts: outside Nuxt's build pipeline (plain
// vitest + @vue/test-utils, no auto-import shim), the bare Nuxt auto-imports this component and its REAL
// child SegmentedControl.vue rely on (`computed`, `inject`, `useI18n`) don't exist, so they are stubbed onto
// globalThis with Vue's own implementations. SegmentedControl is left REAL (not stubbed), exactly like
// SoilReadingModal's own instrument picker — a stub would prove nothing about the actual rendered buttons.
//
// ASSERTION STYLE: `t` is mocked as identity (returns the raw key), the same convention every sibling test
// in this file's family uses (there is no real vue-i18n runtime in this harness). Since identity is the
// only translation available, asserting the RENDERED TEXT and asserting the KEY collapse into the same
// check here — but the key itself is still the strongest available pin: it encodes both the instrument id
// and the level, so a lookup that used the wrong instrument or the wrong level renders visibly different
// text, which is exactly what the "own words" test below needs to catch.
import { describe, it, expect, vi } from 'vitest';
import { computed, inject } from 'vue';
import { mount } from '@vue/test-utils';
import OrdinalReadingPicker from './OrdinalReadingPicker.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

function mountPicker(props: { instrumentId: 'wooden-stick' | 'finger'; modelValue?: number | null }) {
  return mount(OrdinalReadingPicker, { props });
}

describe('OrdinalReadingPicker', () => {
  it("renders one option per level, from the instrument row's own bounds", () => {
    const w = mountPicker({ instrumentId: 'wooden-stick', modelValue: null });
    // wooden-stick: rawMin 1, rawMax 3, rawStep 1 -> 3 levels.
    expect(w.findAll('button')).toHaveLength(3);
  });

  it('emits the LEVEL as the raw value', async () => {
    const w = mountPicker({ instrumentId: 'wooden-stick', modelValue: null });
    await w.findAll('button')[2]!.trigger('click'); // the third option = level 3
    const emitted = w.emitted('update:modelValue');
    expect(emitted?.[0]).toEqual([3]);
    expect(typeof emitted?.[0]?.[0]).toBe('number');
  });

  it('starts with NOTHING selected — an unanswered question must not look answered', () => {
    const w = mountPicker({ instrumentId: 'wooden-stick', modelValue: null });
    const buttons = w.findAll('button');
    expect(buttons.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);
  });

  it("labels each level with THIS instrument's own words", () => {
    const stick = mountPicker({ instrumentId: 'wooden-stick', modelValue: null });
    const finger = mountPicker({ instrumentId: 'finger', modelValue: null });
    const stickLevel1 = stick.findAll('button')[0]!.text();
    const fingerLevel1 = finger.findAll('button')[0]!.text();
    // Both are level 1, but the wooden stick and the finger describe it in different words ("it comes out
    // clean" vs "it feels dry") — the two must not render the same text.
    expect(stickLevel1).not.toBe(fingerLevel1);
    expect(stickLevel1).toBe('reading.levels.wooden-stick.1');
    expect(fingerLevel1).toBe('reading.levels.finger.1');
  });
});
