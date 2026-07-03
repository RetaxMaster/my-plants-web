// The publish guard imports the SAME sentinel the knowledge-engine writes and the API knows, from the
// Zod-free client-safe subpath (structural guarantee: no Zod in the web bundle). No fork — the marker
// lives once in the shared contract.
import { hasThumbnailPrompt } from '@retaxmaster/my-plants-species-schema/blogpost-constants';

// Should we warn the author before publishing? True when the leading-language (ES) body still carries
// the cover-image prompt block that Claude left at the top.
export function needsThumbnailWarning(bodyEs: string | null | undefined): boolean {
  return hasThumbnailPrompt(bodyEs);
}
