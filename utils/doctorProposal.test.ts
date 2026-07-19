// The wire shape of "nothing is pending" is a trap, and this file is the pin for it.
//
// The API's `getPending` returns `null`, which Nest serializes as a 200 with an EMPTY BODY. The API's own
// e2e sees that as `{}` (supertest's parse of an empty body), but the BROWSER does not: ofetch runs the
// body through `destr('')`, which returns the empty STRING. So the value reaching the composable is `''` —
// not `null`, not `{}`, and not undefined.
//
// Why that matters rather than being a curiosity: `''` is not `null`, so a `!== null` guard reads it as
// "there is a pending proposal". The banner itself stays hidden (`''` is falsy), so the bug is INVISIBLE
// in the happy path — but the "banner is gone yet the attempt failed" fallback is gated on
// `!showProposalBanner`, so it would never render either. An approve that hit an expired proposal would
// then look exactly like an approve that worked, which is the silent no-op spec §5.3.1 exists to forbid.
import { describe, it, expect } from 'vitest';
import { normalizePendingProposal } from './doctorProposal';

const PROPOSAL = {
  id: 'prop-1',
  status: 'PENDING',
  summary: 'a caption',
  operations: [{ type: 'profile.update', targetLabel: 'profile', changes: [], destructive: false }],
  autoApproved: false,
  failureCode: null,
  failureReason: null,
  createdAt: '2026-07-18T10:00:00.000Z',
};

describe('normalizePendingProposal', () => {
  it('passes a real proposal through untouched (same object, never a copy)', () => {
    expect(normalizePendingProposal(PROPOSAL)).toBe(PROPOSAL);
  });

  // THE case this helper exists for: what ofetch actually hands back for an empty 200 body.
  it('treats the empty string — the real "nothing pending" wire value — as null', () => {
    expect(normalizePendingProposal('')).toBeNull();
  });

  it('treats the other shapes an empty body can arrive as, as null', () => {
    expect(normalizePendingProposal(null)).toBeNull();
    expect(normalizePendingProposal(undefined)).toBeNull();
    // What the API's own e2e observes; a proxy or a future serializer could produce it here too.
    expect(normalizePendingProposal({})).toBeNull();
  });

  // Refusing a malformed payload is the safe direction: a banner is a CONSENT surface, so rendering one
  // over a half-formed object would ask the owner to approve something nobody can describe.
  it('refuses a payload that could not be rendered as a consent surface', () => {
    expect(normalizePendingProposal({ status: 'PENDING', operations: [] })).toBeNull(); // no id
    expect(normalizePendingProposal({ id: '', operations: [] })).toBeNull(); // empty id
    expect(normalizePendingProposal({ id: 'p1' })).toBeNull(); // no operations
    expect(normalizePendingProposal({ id: 'p1', operations: 'nope' })).toBeNull(); // operations not a list
    expect(normalizePendingProposal('some unexpected text')).toBeNull();
  });

  // A proposal with zero operations is still structurally valid; it is the SERVER's business whether that
  // can happen, not this helper's. Dropping it here would hide a real payload instead of a missing one.
  it('accepts a proposal with an empty operations list', () => {
    const empty = { ...PROPOSAL, operations: [] };
    expect(normalizePendingProposal(empty)).toBe(empty);
  });
});
