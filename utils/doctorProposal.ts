import type { AgentProposal } from '../types/api';

/**
 * Coerce the raw `GET …/proposals/pending` response into "a proposal, or nothing".
 *
 * The server says "nothing is pending" by returning `null`, which Nest serializes as a 200 with an EMPTY
 * BODY. That body does NOT reach the browser as `null`: ofetch parses it with `destr('')`, which yields
 * the empty STRING. A `!== null` check therefore reads "nothing pending" as "something is pending".
 *
 * The failure that causes is subtle enough to be worth spelling out, because it is invisible in the happy
 * path: the banner is guarded on the value being truthy, so `''` renders nothing and everything LOOKS
 * right — but the "the banner is gone and yet the attempt failed" fallback is gated on the banner being
 * hidden, so it would never render either. An approve against an expired proposal would be
 * indistinguishable from an approve that succeeded, which is precisely the silent no-op spec §5.3.1
 * forbids.
 *
 * So the coercion happens ONCE, here, at the boundary — not in each consumer, where the next consumer
 * would forget it.
 *
 * The shape check is deliberately conservative. The banner is a CONSENT surface: rendering one over a
 * payload we cannot fully describe would ask the owner to approve something unreadable. A payload
 * missing an `id` or an `operations` list cannot be resolved (there is nothing to approve) or rendered,
 * so it is treated as "nothing pending" rather than passed on to blow up in the template.
 *
 * Originally scoped to the doctor endpoint only; `getGardenerPendingProposal` (`composables/useApi.ts`)
 * now calls it too, because the empty-body quirk it normalizes belongs to the underlying engine
 * (`KnowledgeChatService`), not to the doctor scope specifically — the gardener's pending-proposal route
 * shares the exact same "nothing pending" = empty body wire shape. Reused here rather than duplicated,
 * per the project's fork-prevention rule: one implementation, injected differences (there are none to
 * inject). The file keeps its `doctorProposal` name only because renaming it is out of scope for the
 * change that added the second caller — a future edit is free to rename it if a third caller ever needs
 * one, but it never gets a second copy.
 */
export function normalizePendingProposal(raw: unknown): AgentProposal | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<AgentProposal>;
  if (typeof candidate.id !== 'string' || candidate.id === '') return null;
  if (!Array.isArray(candidate.operations)) return null;
  return raw as AgentProposal;
}
