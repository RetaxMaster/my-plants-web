// A GET cache + in-flight dedupe for one CACHE SCOPE (one SSR request on the server, or the app on the
// client). Pure + dependency-free so it unit-tests under node; useApi picks the correct scope. Only GETs
// are cached here; mutations call flush().
export interface GetCache {
  get<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  flush(): void;
}

export function createGetCache(): GetCache {
  const inflight = new Map<string, Promise<unknown>>();
  const resolved = new Map<string, unknown>();
  return {
    get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      if (resolved.has(key)) return Promise.resolve(resolved.get(key) as T);
      const existing = inflight.get(key) as Promise<T> | undefined;
      if (existing) return existing;
      // `p` is referenced inside its own .then/.catch (closure over the const, fine — by the time these
      // callbacks run the assignment below has long completed). The `inflight.get(key) === p` check guards
      // against a real race: a flush() (e.g. a concurrent mutation) can clear the maps WHILE this fetch is
      // still pending. Without the guard, this call's late settlement would silently write a pre-mutation
      // value back into `resolved` after the flush — reviving exactly the stale cache the flush existed to
      // kill. Only the call still recognized as the current in-flight entry for this key is allowed to write.
      const p: Promise<T> = fetcher()
        .then((v) => {
          if (inflight.get(key) === p) { resolved.set(key, v); inflight.delete(key); }
          return v;
        })
        .catch((e) => {
          if (inflight.get(key) === p) { inflight.delete(key); resolved.delete(key); }
          throw e;
        });
      inflight.set(key, p);
      return p;
    },
    flush() { inflight.clear(); resolved.clear(); },
  };
}
