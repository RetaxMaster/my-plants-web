// Owner-scoped run wrapper (mirrors useKnowledgeChatRuns, NOT useDoctorChatRuns): mint a fresh single-use
// socket ticket before every (re)connect, with no plant id pinned — the gardener's runs are the owner's
// whole-garden conversation, not one plant's diagnose routes.
export function useGardenerChatRuns() {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintGardenerSocketTicket(runId).then((r) => r.ticket),
  };
}
