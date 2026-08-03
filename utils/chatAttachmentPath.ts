/**
 * THE SINGLE DEFINITION of the chat-attachment route shape, for all three chat surfaces.
 *
 * Two kinds of consumer need it and they sit on opposite sides of the proxy. On the BUILD side, the three
 * per-surface run composables (`useKnowledgeChatRuns` / `useDoctorChatRuns` / `useGardenerChatRuns`) each
 * call the builder for their own surface and hand the finished path to `useApi.ts`'s
 * `fetchChatAttachment`, which is a pure passthrough and never builds one itself. On the RECOGNIZE side,
 * `server/api/[...].ts` must match it to take its binary branch instead of the generic JSON passthrough.
 * (This paragraph previously named `useApi.ts` as the builder, which was never true — recorded here
 * because a reader who believes the builder lives in `useApi.ts` will add the second spelling in a
 * composable, which is exactly the failure below.)
 * A second spelling on either side is a silent failure — the BFF falls through,
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
