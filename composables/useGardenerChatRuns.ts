import { gardenerChatAttachmentPath } from '../utils/chatAttachmentPath.js';

// Owner-scoped run wrapper (mirrors useKnowledgeChatRuns, NOT useDoctorChatRuns): mint a fresh single-use
// socket ticket before every (re)connect, with no plant id pinned — the gardener's runs are the owner's
// whole-garden conversation, not one plant's diagnose routes.
export function useGardenerChatRuns() {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintGardenerSocketTicket(runId).then((r) => r.ticket),
    // Restored-attachment recall (spec 2026-08-01 §3.4), owner-anchored — no plant id in the path.
    // Returns BYTES, never a url — the chat package owns every object url it mints and revokes all of
    // them.
    fetchAttachment: (sessionId: string, runId: string, attachmentId: string) =>
      api.fetchChatAttachment(gardenerChatAttachmentPath(sessionId, runId, attachmentId)),
  };
}
