// Plant-scoped run wrapper (mirrors useKnowledgeChatRuns): mint a fresh single-use socket ticket before
// every (re)connect, pinned to this plant's diagnose routes.
export function useDoctorChatRuns(plantId: string) {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintDoctorSocketTicket(plantId, runId).then((r) => r.ticket),
  };
}
