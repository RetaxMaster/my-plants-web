// The adapter's whole job is to expose the shared ChatProposalsAdapter shape with NO plantId closed over —
// the gardener is owner-scoped, not plant-scoped, unlike useDoctorChatProposals. approve/decline are
// specified as EMPTY-BODY posts, and a non-empty body is a 400 from the API (asserted at the useApi layer;
// this test only asserts the adapter forwards the session/proposal ids and nothing else).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatProposalsAdapter } from '../types/api';
import { useGardenerChatProposals } from './useGardenerChatProposals';

const calls: Array<{ name: string; args: unknown[] }> = [];
const record = (name: string) => vi.fn((...args: unknown[]) => {
  calls.push({ name, args });
  return Promise.resolve(null);
});

let spies: Record<string, ReturnType<typeof record>>;

beforeEach(() => {
  calls.length = 0;
  spies = {
    getGardenerPendingProposal: record('getGardenerPendingProposal'),
    approveGardenerProposal: record('approveGardenerProposal'),
    declineGardenerProposal: record('declineGardenerProposal'),
    getGardenerSessionSettings: record('getGardenerSessionSettings'),
    updateGardenerSessionSettings: record('updateGardenerSessionSettings'),
  };
  vi.stubGlobal('useApi', () => spies);
});

describe('useGardenerChatProposals', () => {
  it('satisfies ChatProposalsAdapter with the owner scope, closing over no plantId', async () => {
    const a: ChatProposalsAdapter = useGardenerChatProposals();
    await a.pending('S1');
    expect(spies.getGardenerPendingProposal).toHaveBeenCalledWith('S1');
  });

  it('forwards approve and decline with the session and proposal ids (approve also forwards the idempotency key)', async () => {
    const a = useGardenerChatProposals();
    // AF-12: `approve` takes a THIRD argument, the caller-minted stable idempotency key — the adapter's
    // job is just to forward it, never to mint or alter it.
    await a.approve('S1', 'PR1', 'idem-key-1');
    expect(spies.approveGardenerProposal).toHaveBeenCalledWith('S1', 'PR1', 'idem-key-1');

    await a.decline('S1', 'PR1');
    expect(spies.declineGardenerProposal).toHaveBeenCalledWith('S1', 'PR1');
  });

  it('forwards settings reads/writes with the session id only', async () => {
    const a = useGardenerChatProposals();
    await a.getSettings('S1');
    expect(spies.getGardenerSessionSettings).toHaveBeenCalledWith('S1');

    await a.setSettings('S1', true);
    expect(spies.updateGardenerSessionSettings).toHaveBeenCalledWith('S1', true);
  });

  it('never calls a plant-scoped (doctor) endpoint', async () => {
    const a = useGardenerChatProposals();
    await a.pending('S1');
    await a.approve('S1', 'PR1', 'idem-key-1');
    await a.decline('S1', 'PR1');
    await a.getSettings('S1');
    await a.setSettings('S1', false);

    expect(calls.map((c) => c.name)).toEqual([
      'getGardenerPendingProposal',
      'approveGardenerProposal',
      'declineGardenerProposal',
      'getGardenerSessionSettings',
      'updateGardenerSessionSettings',
    ]);
    // V7 fix (code review) — a bare `args.length <= 3` guard is satisfied by a call carrying a `plantId`
    // PREPENDED to the session/proposal ids (e.g. `['plant-1', 'S1', 'PR1']`, exactly `useDoctorChatProposals`'s
    // own shape), which is precisely the plant-scoped leak this test's title claims to rule out. Asserting
    // the EXACT argument list per call — the same technique `useDoctorChatProposals.test.ts`'s own "binds
    // the plant id into every call" test uses — discriminates a genuine leak from a merely-short array: a
    // `plantId` prepended here would fail every one of these five equalities, not just the length check.
    expect(calls[0].args).toEqual(['S1']);
    expect(calls[1].args).toEqual(['S1', 'PR1', 'idem-key-1']);
    expect(calls[2].args).toEqual(['S1', 'PR1']);
    expect(calls[3].args).toEqual(['S1']);
    expect(calls[4].args).toEqual(['S1', false]);
  });
});
