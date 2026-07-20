import type { KnowledgeChatProvider, KnowledgeChatSendInput } from '../types/api';

// Thin session-scoped wrapper over useApi (mirrors retaxmaster's useCvSessions): list / create /
// fetch / resume / remove, plus the agents the engine can actually run. Centralizing here keeps the
// page and the chat component from drifting.
export function useKnowledgeChatSessions() {
  const api = useApi();
  return {
    list: () => api.listKnowledgeSessions(),
    fetch: (id: string) => api.getKnowledgeSession(id),
    // Creating a conversation picks its agent; resuming never does (the conversation owns it).
    create: (input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) => api.createKnowledgeSession(input, provider),
    resume: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      api.resumeKnowledgeSession(id, input, provider),
    remove: (id: string) => api.deleteKnowledgeSession(id),
    // Canonical, engine-rebuilt transcript for seeding a reopened conversation.
    history: (id: string) => api.getKnowledgeSessionHistory(id),
    providers: (force = false) => api.listKnowledgeProviders(force),
    commands: (provider: KnowledgeChatProvider) => api.getKnowledgeCommands(provider),
  };
}
