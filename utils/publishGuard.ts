// Should we warn the author before publishing? True when the post has NO cover image. The cover is
// also the post's Meta/OG preview (Spec C), so publishing without one yields a poor social/SEO card.
// This is a soft warning, not a block — the author may publish anyway.
export function needsCoverWarning(coverImageUrl: string | null | undefined): boolean {
  return !coverImageUrl;
}
