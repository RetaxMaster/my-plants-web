import type { KnowledgeChatProvider, KnowledgeChatSendInput } from '../types/api';

// Owner-scoped session wrapper (mirrors useKnowledgeChatSessions, NOT useDoctorChatSessions): list / fetch
// / create / resume / remove / history + provider availability + command catalog, with NO id closed over —
// the gardener is scoped to the owner's whole garden, exactly like the Knowledge Engine pool, unlike the
// doctor's per-plant pin. Shaped identically to the other two so it satisfies the shared component's
// ChatWorkspaceSessionsAdapter contract — one component, injected scope (fork-prevention).
export function useGardenerChatSessions() {
  const api = useApi();
  return {
    list: () => api.listGardenerSessions(),
    fetch: (id: string) => api.getGardenerSession(id),
    create: (input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) => api.createGardenerSession(input, provider),
    resume: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      api.resumeGardenerSession(id, input, provider),
    remove: (id: string) => api.deleteGardenerSession(id),
    history: (id: string) => api.getGardenerSessionHistory(id),
    providers: (force = false) => api.listGardenerProviders(force),
    commands: (provider: KnowledgeChatProvider) => api.getGardenerCommands(provider),
  };
}
