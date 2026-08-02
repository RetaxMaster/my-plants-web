/**
 * THE SINGLE DEFINITION of the chat-attachment route shape, for all three chat surfaces.
 *
 * Two consumers need it and they sit on opposite sides of the proxy: `composables/useApi.ts` BUILDS one
 * of these paths, and `server/api/[...].ts` must RECOGNIZE it to take its binary branch instead of the
 * generic JSON passthrough. A second spelling on either side is a silent failure — the BFF falls through,
 * `$fetch` parses the bytes, and the browser receives an index-keyed object rather than an image, with
 * every unit test on both sides still green.
 */
const enc = encodeURIComponent;

/** `GET /knowledge-chat/sessions/:sid/runs/:runId/attachments/:attachmentId` (admin KE surface). */
export const knowledgeChatAttachmentPath = (sessionId: string, runId: string, attachmentId: string): string =>
  `/knowledge-chat/sessions/${enc(sessionId)}/runs/${enc(runId)}/attachments/${enc(attachmentId)}`;

/** `GET /plants/:id/diagnose/sessions/:sid/runs/:runId/attachments/:attachmentId` (Plant Doctor). */
export const doctorChatAttachmentPath = (
  plantId: string, sessionId: string, runId: string, attachmentId: string,
): string =>
  `/plants/${enc(plantId)}/diagnose/sessions/${enc(sessionId)}/runs/${enc(runId)}/attachments/${enc(attachmentId)}`;

/** `GET /gardener/sessions/:sid/runs/:runId/attachments/:attachmentId` (whole-garden Gardener). */
export const gardenerChatAttachmentPath = (sessionId: string, runId: string, attachmentId: string): string =>
  `/gardener/sessions/${enc(sessionId)}/runs/${enc(runId)}/attachments/${enc(attachmentId)}`;

// DELIBERATELY NARROW. Every other route this proxy carries returns JSON; the binary branch must claim
// exactly these three shapes and nothing adjacent to them.
const CHAT_ATTACHMENT_PATH =
  /^\/(?:knowledge-chat|gardener|plants\/[^/]+\/diagnose)\/sessions\/[^/]+\/runs\/[^/]+\/attachments\/[^/?]+(?:\?.*)?$/;

/** True for a path whose response is RAW IMAGE BYTES rather than JSON. Used by the BFF proxy only. */
export const isChatAttachmentPath = (path: string): boolean => CHAT_ATTACHMENT_PATH.test(path);
