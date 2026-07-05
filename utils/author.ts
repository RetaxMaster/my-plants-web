// Canonical blog author (single source — the byline never hardcodes this per page). v1 has one
// fixed author; a per-post author would be an additive DB change later. The avatar is a static
// asset at public/authors/retaxmaster.webp; AuthorByline degrades to initials if it is missing, so
// the build/preview never breaks on a missing file.
export const BLOG_AUTHOR = {
  name: 'Carlos Eduardo Gómez García',
  handle: '@retaxmaster',
  avatar: '/authors/retaxmaster.webp',
} as const;
