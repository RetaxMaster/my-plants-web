import type { ChatProposalsAdapter } from '../types/api';

// The gardener's analogue of useDoctorChatProposals: the SAME generic adapter interface, closing over the
// owner scope instead of a plantId. The shared banner and AgentSkipPermissions consume this shape as-is —
// neither component changes to host a third surface.
export function useGardenerChatProposals(): ChatProposalsAdapter {
  const api = useApi();
  return {
    pending: (sessionId: string) => api.getGardenerPendingProposal(sessionId),
    approve: (sessionId: string, proposalId: string, idempotencyKey: string) =>
      api.approveGardenerProposal(sessionId, proposalId, idempotencyKey),
    decline: (sessionId: string, proposalId: string) => api.declineGardenerProposal(sessionId, proposalId),
    getSettings: (sessionId: string) => api.getGardenerSessionSettings(sessionId),
    setSettings: (sessionId: string, skipPermissions: boolean) => api.updateGardenerSessionSettings(sessionId, skipPermissions),
  };
}
