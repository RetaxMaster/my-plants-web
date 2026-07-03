// Single source of truth for the admin "Acting As" impersonation control. Centralizing start/stop
// here (instead of repeating the handler in the owners page, the account menu, and the layout banner)
// keeps the three call sites from drifting and gives them shared error handling: a failed call no
// longer leaves a silently-dead button — it surfaces and resets `pending` so the button is retryable.
//
// There is no toast system in this app yet, so failures surface via `alert()` (acceptable for a
// low-frequency, admin-only control); a future toast layer would replace that one line.
export function useActingAs() {
  const { session } = useUserSession();
  const { t } = useI18n();
  const api = useApi();

  const actingAs = computed(() => session.value?.actingAs ?? null);
  const pending = ref(false);

  // Hard reload so every owner-scoped page refetches under the new effective owner.
  // `force: true` is REQUIRED: reloadNuxtApp keeps a per-path anti-loop guard in sessionStorage and
  // skips a reload to the same path within ~10s. Start (→ '/') then Stop (→ '/') happen in quick
  // succession, so without force the second call silently no-ops — the banner would stay and `pending`
  // would never reset (button stuck disabled). force bypasses the guard so every transition reloads.
  async function run(action: () => Promise<unknown>, failure: string) {
    if (pending.value) return;
    pending.value = true;
    try {
      await action();
      reloadNuxtApp({ path: '/', force: true });
    } catch (e) {
      pending.value = false;
      console.error(failure, e);
      if (import.meta.client) alert(failure);
    }
  }

  const start = (ownerId: string) => run(() => api.actAs(ownerId), t('actingAs.switchError'));
  const stop = () => run(() => api.stopActingAs(), t('actingAs.stopError'));

  return { actingAs, pending, start, stop };
}
