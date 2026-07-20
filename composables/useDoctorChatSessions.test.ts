// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { ChatRunsAdapter, ChatWorkspaceSessionsAdapter } from '../types/api';
import { useDoctorChatSessions } from './useDoctorChatSessions';
import { useDoctorChatRuns } from './useDoctorChatRuns';

// The composables call useApi() (a Nuxt auto-import). Stub it with spies and assert each method forwards to
// the plant-scoped endpoint helper with the pinned plantId first.
function stubApi() {
  const spies = {
    listDoctorSessions: vi.fn().mockResolvedValue([]),
    getDoctorSession: vi.fn().mockResolvedValue({}),
    createDoctorSession: vi.fn().mockResolvedValue({ sessionId: 's', runId: 'r', ticket: 't' }),
    resumeDoctorSession: vi.fn().mockResolvedValue({ runId: 'r', ticket: 't' }),
    deleteDoctorSession: vi.fn().mockResolvedValue({ ok: true }),
    getDoctorSessionHistory: vi.fn().mockResolvedValue({ turns: [] }),
    listDoctorProviders: vi.fn().mockResolvedValue([]),
    getDoctorCommands: vi.fn().mockResolvedValue({ commands: [] }),
    mintDoctorSocketTicket: vi.fn().mockResolvedValue({ ticket: 'tick' }),
  };
  vi.stubGlobal('useApi', () => spies);
  return spies;
}

describe('useDoctorChatSessions', () => {
  it('binds plantId and forwards every method to the plant-scoped endpoint', async () => {
    const spies = stubApi();
    const s = useDoctorChatSessions('plant-1');

    await s.list();
    expect(spies.listDoctorSessions).toHaveBeenCalledWith('plant-1');

    await s.fetch('sess-9');
    expect(spies.getDoctorSession).toHaveBeenCalledWith('plant-1', 'sess-9');

    await s.create({ prompt: 'hello' }, 'claude');
    expect(spies.createDoctorSession).toHaveBeenCalledWith('plant-1', { prompt: 'hello' }, 'claude');

    await s.resume('sess-9', { prompt: 'more' }, 'claude');
    expect(spies.resumeDoctorSession).toHaveBeenCalledWith('plant-1', 'sess-9', { prompt: 'more' }, 'claude');

    await s.remove('sess-9');
    expect(spies.deleteDoctorSession).toHaveBeenCalledWith('plant-1', 'sess-9');

    await s.history('sess-9');
    expect(spies.getDoctorSessionHistory).toHaveBeenCalledWith('plant-1', 'sess-9');

    await s.providers(true);
    expect(spies.listDoctorProviders).toHaveBeenCalledWith('plant-1', true);

    await s.commands('codex');
    expect(spies.getDoctorCommands).toHaveBeenCalledWith('plant-1', 'codex');
  });

  it('satisfies the ChatWorkspaceSessionsAdapter contract (the superset the shell consumes)', () => {
    stubApi();
    // Compile-time conformance: assigning to the adapter type fails to typecheck if a method is missing or
    // mis-shaped. ChatWorkspaceSessionsAdapter extends ChatSessionsAdapter (list/fetch/remove + the inner
    // set), so this also proves the inner <AgentChat> contract. (The value assertion is incidental.)
    const adapter: ChatWorkspaceSessionsAdapter = useDoctorChatSessions('plant-1');
    expect(typeof adapter.create).toBe('function');
    expect(typeof adapter.list).toBe('function');
  });
});

describe('useDoctorChatRuns', () => {
  it('mints a plant-scoped socket ticket and returns the raw ticket string', async () => {
    const spies = stubApi();
    const runs: ChatRunsAdapter = useDoctorChatRuns('plant-1');
    const ticket = await runs.mintSocketTicket('run-7');
    expect(spies.mintDoctorSocketTicket).toHaveBeenCalledWith('plant-1', 'run-7');
    expect(ticket).toBe('tick');
  });
});
