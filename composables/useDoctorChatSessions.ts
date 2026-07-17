import type { KnowledgeChatProvider, KnowledgeChatSendInput } from '../types/api';

// Plant-scoped session wrapper (mirrors useKnowledgeChatSessions): list / fetch / create / resume /
// remove / history + provider availability + command catalog, all pinned to ONE plant. Shaped identically
// to the KE composable so it satisfies the shared component's ChatSessionsAdapter contract — one component,
// injected scope (fork-prevention).
export function useDoctorChatSessions(plantId: string) {
  const api = useApi();
  return {
    list: () => api.listDoctorSessions(plantId),
    fetch: (id: string) => api.getDoctorSession(plantId, id),
    create: (prompt: string, provider: KnowledgeChatProvider) => api.createDoctorSession(plantId, prompt, provider),
    resume: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      api.resumeDoctorSession(plantId, id, input, provider),
    remove: (id: string) => api.deleteDoctorSession(plantId, id),
    history: (id: string) => api.getDoctorSessionHistory(plantId, id),
    providers: (force = false) => api.listDoctorProviders(plantId, force),
    commands: (provider: KnowledgeChatProvider) => api.getDoctorCommands(plantId, provider),
  };
}
