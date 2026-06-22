/**
 * useIsDesktop — a reactive viewport-width flag for NON-STRUCTURAL niceties only
 * (e.g. the two-column plant-detail layout in a later phase).
 *
 * IMPORTANT: never use this to decide which navigation to render. The app shell
 * renders BOTH navs in the DOM and shows/hides them with pure CSS media queries
 * so SSR and the first client render agree — driving nav presence from JS here
 * would reintroduce a hydration mismatch / FOUC. On the server (and the very
 * first client render, before mount) this returns `false` so both sides match.
 */
export function useIsDesktop(breakpoint = 880) {
  const isDesktop = ref(false);

  if (import.meta.client) {
    const query = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => {
      isDesktop.value = query.matches;
    };
    onMounted(() => {
      update();
      query.addEventListener('change', update);
    });
    onBeforeUnmount(() => query.removeEventListener('change', update));
  }

  return isDesktop;
}
