// Thin session-scoped wrapper over useApi (mirrors retaxmaster's useCvSessions): list / create /
// fetch / resume / remove. Centralizing here keeps the page and the chat component from drifting.
export function useKnowledgeChatSessions() {
  const api = useApi();
  return {
    list: () => api.listKnowledgeSessions(),
    fetch: (id: string) => api.getKnowledgeSession(id),
    create: (prompt: string) => api.createKnowledgeSession(prompt),
    resume: (id: string, prompt: string) => api.resumeKnowledgeSession(id, prompt),
    remove: (id: string) => api.deleteKnowledgeSession(id),
  };
}
