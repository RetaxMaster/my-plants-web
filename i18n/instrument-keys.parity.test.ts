import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  INSTRUMENT_LIST,
  resolutionStates,
} from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

// ---------------------------------------------------------------------------------------------------
// THE GUARD FOR A CLASS OF DEFECT THAT HAS NOW SHIPPED TWICE.
//
// Several strings in this app are looked up with a key BUILT AT RUNTIME from an instrument's id:
//
//     t(`reading.honesty.${instrument.id}`)          SoilReadingModal.vue
//     t(`settings.instruments.name.${row.id}`)       pages/settings.vue
//     t(`reading.levels.${instrument.id}.${level}`)  OrdinalReadingPicker.vue
//
// A computed key is invisible to EVERY gate this project runs. TypeScript cannot type a template
// literal against a JSON tree it never loaded; the linter has nothing to flag; no component test
// asserted the rendered sentence; vue-i18n does not throw on a miss -- it RENDERS THE KEY PATH as if it
// were prose and logs a warning nobody reads in CI. So adding a row to the shared instrument contract
// silently manufactures a missing translation, and the app cheerfully prints
// `reading.honesty.wooden-stick` at the owner.
//
// That is not hypothetical and it is not one bug:
//   * 2026-08-09 -- `settings.instruments.name.wooden-stick` rendered raw on /settings.
//   * 2026-08-10 -- `reading.honesty.wooden-stick` and `.finger` rendered raw inside the measuring
//     dialog, found by QA, AFTER a three-round peer code-review gate and 2345 unit + 336 e2e tests had
//     all passed. None of them could see it.
//
// WHY THIS TEST IS DRIVEN BY THE CONTRACT AND NEVER BY A HAND-WRITTEN LIST OF IDS: a hand-written list
// is the same defect wearing a test's clothes. Whoever adds the fifth instrument would add it to the
// contract and not to the list, the test would keep passing over four ids, and the fifth would ship raw
// exactly like the first two did. Iterating `INSTRUMENT_LIST` is what makes the new row's copy
// impossible to forget: the contract change itself turns this test red until the strings exist.
// ---------------------------------------------------------------------------------------------------

const LOCALES = ['en', 'es'] as const;

const messages = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`./locales/${locale}.json`, import.meta.url)), 'utf8'),
    ) as Record<string, unknown>,
  ]),
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

/** Resolves a dotted path the same way vue-i18n does, returning the leaf only when it is a real string. */
function lookup(tree: Record<string, unknown>, path: string): string | undefined {
  const leaf = path.split('.').reduce<unknown>(
    (node, segment) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
    tree,
  );
  return typeof leaf === 'string' ? leaf : undefined;
}

/** Every key the UI derives from THIS instrument row, in both capture styles. */
function derivedKeysFor(row: (typeof INSTRUMENT_LIST)[number]): string[] {
  const keys = [
    `settings.instruments.name.${row.id}`,
    `settings.instruments.unit.${row.id}`,
    `settings.instruments.help.${row.id}`,
    `reading.honesty.${row.id}`,
  ];
  // An ordinal row is captured as named states, so it owes one label PER STATE. The count comes from the
  // contract's own `resolutionStates` -- never a literal 3 -- so a future 4-state instrument demands its
  // fourth label here without anyone remembering to ask for it.
  if (row.captureKind === 'ordinal') {
    const states = resolutionStates(row);
    expect(
      states,
      `${row.id} is ordinal, so its contract row must declare a finite number of states`,
    ).toBeTypeOf('number');
    for (let level = row.rawMin; level <= (row.rawMax as number); level += row.rawStep) {
      keys.push(`reading.levels.${row.id}.${level}`);
    }
  }
  return keys;
}

describe('every instrument in the shared contract has the copy the UI derives from its id', () => {
  it('ships at least the four instruments this guard was written for', () => {
    // A sanity floor, not a contract assertion: if `INSTRUMENT_LIST` were ever empty or unresolvable the
    // per-locale loops below would iterate zero times and this whole file would pass vacuously -- the
    // failure mode a guard must never have.
    expect(INSTRUMENT_LIST.length).toBeGreaterThanOrEqual(4);
  });

  for (const locale of LOCALES) {
    for (const row of INSTRUMENT_LIST) {
      it(`${locale}: ${row.id} (${row.captureKind})`, () => {
        for (const key of derivedKeysFor(row)) {
          const value = lookup(messages[locale], key);
          expect(
            value,
            `${locale}.json is missing \`${key}\`. vue-i18n does not throw on a miss -- it renders the ` +
              `key path to the owner as if it were a sentence. Add the string; do not delete the key ` +
              `from the caller.`,
          ).toBeTypeOf('string');
          expect(value!.trim(), `${locale}.json has \`${key}\` but it is empty`).not.toBe('');
          // A copy-paste of the key into the value would satisfy "is a non-empty string" while looking
          // exactly like the defect this file exists to prevent.
          expect(value, `${locale}.json's \`${key}\` is just the key path repeated back`).not.toBe(key);
        }
      });
    }
  }
});
