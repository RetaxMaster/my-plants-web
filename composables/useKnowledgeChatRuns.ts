// Run-scoped wrapper (mirrors useCvRuns): mint a fresh single-use socket ticket before every
// (re)connect, and fetch a run's raw NDJSON transcript for log-rebuild.
export function useKnowledgeChatRuns() {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintKnowledgeSocketTicket(runId).then((r) => r.ticket),
    fetchLog: (logUrl: string) => api.fetchKnowledgeRunLog(logUrl),
  };
}
