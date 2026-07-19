import type { ChatProposalsAdapter } from '../types/api';

// Plant-scoped proposals wrapper (mirrors useDoctorChatSessions / useDoctorChatRuns): binds ONE plantId
// and exposes exactly the ChatProposalsAdapter shape the shared <AgentChat> consumes. The Knowledge
// Engine has no equivalent and injects nothing, which is what makes its chat structurally incapable of
// rendering an approval surface — one component, injected scope (fork-prevention).
export function useDoctorChatProposals(plantId: string): ChatProposalsAdapter {
  const api = useApi();
  return {
    pending: (sessionId: string) => api.getDoctorPendingProposal(plantId, sessionId),
    approve: (sessionId: string, proposalId: string) => api.approveDoctorProposal(plantId, sessionId, proposalId),
    decline: (sessionId: string, proposalId: string) => api.declineDoctorProposal(plantId, sessionId, proposalId),
    getSettings: (sessionId: string) => api.getDoctorSessionSettings(plantId, sessionId),
    setSettings: (sessionId: string, skipPermissions: boolean) =>
      api.updateDoctorSessionSettings(plantId, sessionId, skipPermissions),
  };
}
