import { doctorChatAttachmentPath } from '../utils/chatAttachmentPath.js';

// Plant-scoped run wrapper (mirrors useKnowledgeChatRuns): mint a fresh single-use socket ticket before
// every (re)connect, pinned to this plant's diagnose routes.
export function useDoctorChatRuns(plantId: string) {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintDoctorSocketTicket(plantId, runId).then((r) => r.ticket),
    // Restored-attachment recall (spec 2026-08-01 §3.4), pinned to THIS plant's diagnose routes. Returns
    // BYTES, never a url — the chat package owns every object url it mints and revokes all of them.
    fetchAttachment: (sessionId: string, runId: string, attachmentId: string) =>
      api.fetchChatAttachment(doctorChatAttachmentPath(plantId, sessionId, runId, attachmentId)),
  };
}
