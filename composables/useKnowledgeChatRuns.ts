// Run-scoped wrapper: mint a fresh single-use socket ticket before every (re)connect.
//
// The raw-NDJSON `fetchLog` that used to live here is GONE: since agents-realtime 1.0.0 a run log carries
// out-of-band lines (header, identity, internal events) and canonical AgentEvents, and rebuilding a
// transcript from it is the ENGINE's job (see the session-history endpoint). Parsing it in the browser
// would fork engine logic into the frontend.
export function useKnowledgeChatRuns() {
  const api = useApi();
  return {
    mintSocketTicket: (runId: string) => api.mintKnowledgeSocketTicket(runId).then((r) => r.ticket),
  };
}
