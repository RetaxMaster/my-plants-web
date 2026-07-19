import type { DoctorProposal } from '../types/api';

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
 */
export function normalizePendingProposal(raw: unknown): DoctorProposal | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<DoctorProposal>;
  if (typeof candidate.id !== 'string' || candidate.id === '') return null;
  if (!Array.isArray(candidate.operations)) return null;
  return raw as DoctorProposal;
}
