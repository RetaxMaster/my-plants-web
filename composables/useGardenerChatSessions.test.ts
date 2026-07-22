// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { ChatRunsAdapter, ChatWorkspaceSessionsAdapter } from '../types/api';
import { useGardenerChatSessions } from './useGardenerChatSessions';
import { useGardenerChatRuns } from './useGardenerChatRuns';

// The composables call useApi() (a Nuxt auto-import). Stub it with spies and assert each method forwards to
// the owner-scoped endpoint helper — no plantId, unlike the doctor's equivalent test.
function stubApi() {
  const spies = {
    listGardenerSessions: vi.fn().mockResolvedValue([]),
    getGardenerSession: vi.fn().mockResolvedValue({}),
    createGardenerSession: vi.fn().mockResolvedValue({ sessionId: 's', runId: 'r', ticket: 't' }),
    resumeGardenerSession: vi.fn().mockResolvedValue({ runId: 'r', ticket: 't' }),
    deleteGardenerSession: vi.fn().mockResolvedValue({ ok: true }),
    getGardenerSessionHistory: vi.fn().mockResolvedValue({ turns: [] }),
    listGardenerProviders: vi.fn().mockResolvedValue([]),
    getGardenerCommands: vi.fn().mockResolvedValue({ commands: [] }),
    mintGardenerSocketTicket: vi.fn().mockResolvedValue({ ticket: 'tick' }),
  };
  vi.stubGlobal('useApi', () => spies);
  return spies;
}

describe('useGardenerChatSessions', () => {
  it('exposes the eight workspace adapter methods, closing over NO plant id', () => {
    stubApi();
    const a = useGardenerChatSessions();
    expect(Object.keys(a).sort()).toEqual(['commands', 'create', 'fetch', 'history', 'list', 'providers', 'remove', 'resume']);
  });

  it('calls the owner-scoped endpoints, never a plant-scoped one', async () => {
    const spies = stubApi();
    await useGardenerChatSessions().list();
    expect(spies.listGardenerSessions).toHaveBeenCalledWith();
  });

  it('forwards every method to the owner-scoped endpoint with no bound id', async () => {
    const spies = stubApi();
    const s = useGardenerChatSessions();

    await s.fetch('sess-9');
    expect(spies.getGardenerSession).toHaveBeenCalledWith('sess-9');

    await s.create({ prompt: 'hello' }, 'claude');
    expect(spies.createGardenerSession).toHaveBeenCalledWith({ prompt: 'hello' }, 'claude');

    await s.resume('sess-9', { prompt: 'more' }, 'claude');
    expect(spies.resumeGardenerSession).toHaveBeenCalledWith('sess-9', { prompt: 'more' }, 'claude');

    await s.remove('sess-9');
    expect(spies.deleteGardenerSession).toHaveBeenCalledWith('sess-9');

    await s.history('sess-9');
    expect(spies.getGardenerSessionHistory).toHaveBeenCalledWith('sess-9');

    await s.providers(true);
    expect(spies.listGardenerProviders).toHaveBeenCalledWith(true);

    await s.commands('codex');
    expect(spies.getGardenerCommands).toHaveBeenCalledWith('codex');
  });

  it('satisfies the ChatWorkspaceSessionsAdapter contract (the superset the shell consumes)', () => {
    stubApi();
    // Compile-time conformance: assigning to the adapter type fails to typecheck if a method is missing or
    // mis-shaped. (The value assertion is incidental.)
    const adapter: ChatWorkspaceSessionsAdapter = useGardenerChatSessions();
    expect(typeof adapter.create).toBe('function');
    expect(typeof adapter.list).toBe('function');
  });
});

describe('useGardenerChatRuns', () => {
  it('mints an owner-scoped socket ticket and returns the raw ticket string', async () => {
    const spies = stubApi();
    const runs: ChatRunsAdapter = useGardenerChatRuns();
    const ticket = await runs.mintSocketTicket('run-7');
    expect(spies.mintGardenerSocketTicket).toHaveBeenCalledWith('run-7');
    expect(ticket).toBe('tick');
  });
});
