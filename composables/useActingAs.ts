// Single source of truth for the admin "Acting As" impersonation control. Centralizing start/stop
// here (instead of repeating the handler in the owners page, the account menu, and the layout banner)
// keeps the three call sites from drifting and gives them shared error handling: a failed call no
// longer leaves a silently-dead button — it surfaces and resets `pending` so the button is retryable.
//
// There is no toast system in this app yet, so failures surface via `alert()` (acceptable for a
// low-frequency, admin-only control); a future toast layer would replace that one line.
export function useActingAs() {
  const { session } = useUserSession();
  const api = useApi();

  const actingAs = computed(() => session.value?.actingAs ?? null);
  const pending = ref(false);

  // Hard reload so every owner-scoped page refetches under the new effective owner.
  async function run(action: () => Promise<unknown>, failure: string) {
    if (pending.value) return;
    pending.value = true;
    try {
      await action();
      reloadNuxtApp({ path: '/' });
    } catch (e) {
      pending.value = false;
      console.error(failure, e);
      if (import.meta.client) alert(failure);
    }
  }

  const start = (ownerId: string) => run(() => api.actAs(ownerId), 'Could not switch user. Please try again.');
  const stop = () => run(() => api.stopActingAs(), 'Could not stop acting as. Please try again.');

  return { actingAs, pending, start, stop };
}
