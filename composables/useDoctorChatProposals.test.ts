// The adapter's whole job is to bind ONE plantId into every call and expose the shape the shared
// <AgentChat> consumes. The regression it guards against is a wrong URL or a stray request body —
// approve/decline are specified as EMPTY-BODY posts, and a non-empty body is a 400 from the API.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDoctorChatProposals } from './useDoctorChatProposals';

const calls: Array<{ name: string; args: unknown[] }> = [];
const record = (name: string) => (...args: unknown[]) => {
  calls.push({ name, args });
  return Promise.resolve(null);
};

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('useApi', () => ({
    getDoctorPendingProposal: record('getDoctorPendingProposal'),
    approveDoctorProposal: record('approveDoctorProposal'),
    declineDoctorProposal: record('declineDoctorProposal'),
    getDoctorSessionSettings: record('getDoctorSessionSettings'),
    updateDoctorSessionSettings: record('updateDoctorSessionSettings'),
  }));
});

describe('useDoctorChatProposals', () => {
  it('binds the plant id into every call', async () => {
    const p = useDoctorChatProposals('plant-1');
    await p.pending('sess-1');
    await p.approve('sess-1', 'prop-1');
    await p.decline('sess-1', 'prop-1');
    await p.getSettings('sess-1');
    await p.setSettings('sess-1', true);

    expect(calls.map((c) => c.name)).toEqual([
      'getDoctorPendingProposal',
      'approveDoctorProposal',
      'declineDoctorProposal',
      'getDoctorSessionSettings',
      'updateDoctorSessionSettings',
    ]);
    expect(calls[0].args).toEqual(['plant-1', 'sess-1']);
    expect(calls[1].args).toEqual(['plant-1', 'sess-1', 'prop-1']);
    expect(calls[2].args).toEqual(['plant-1', 'sess-1', 'prop-1']);
    expect(calls[3].args).toEqual(['plant-1', 'sess-1']);
    expect(calls[4].args).toEqual(['plant-1', 'sess-1', true]);
  });
});
