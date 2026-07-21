import { describe, expect, it } from 'vitest';
import { PROPOSAL_OPERATION_TYPES } from '@retaxmaster/my-plants-species-schema';
import { OP_TYPE_KEY } from './agentProposalOpTypes';

describe('OP_TYPE_KEY', () => {
  it('maps the dotted wire discriminant to a flat camelCase i18n leaf', () => {
    // A dot inside an i18n leaf key is read by vue-i18n as a NESTING separator, so the wire value can
    // never be used as a key directly. That is why this map exists at all.
    expect(OP_TYPE_KEY['place.update']).toBe('placeUpdate');
    expect(OP_TYPE_KEY['plant.create']).toBe('plantCreate');
  });

  it('has no key containing a dot', () => {
    expect(Object.values(OP_TYPE_KEY).filter((v) => v.includes('.'))).toEqual([]);
  });

  it('has a label key for every operation type in the API union', () => {
    // NOT `Object.keys(probe).length === Object.keys(OP_TYPE_KEY).length` — `probe` IS `OP_TYPE_KEY`,
    // so that comparison is true by construction and can never fail. Compare against the CONTRACT.
    expect(Object.keys(OP_TYPE_KEY).sort()).toEqual([...PROPOSAL_OPERATION_TYPES].sort());
  });
});
