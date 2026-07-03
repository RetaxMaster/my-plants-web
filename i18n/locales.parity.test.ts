import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';

type Tree = { [k: string]: string | Tree };

function keyPaths(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? keyPaths(v as Tree, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('locale catalogues', () => {
  it('have byte-identical key trees (en vs es)', () => {
    const enKeys = keyPaths(en as Tree).sort();
    const esKeys = keyPaths(es as Tree).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('have no empty string values', () => {
    const values = (obj: Tree): string[] =>
      Object.values(obj).flatMap((v) => (typeof v === 'object' && v !== null ? values(v as Tree) : [v as string]));
    expect(values(en as Tree).every((v) => v.length > 0)).toBe(true);
    expect(values(es as Tree).every((v) => v.length > 0)).toBe(true);
  });
});
