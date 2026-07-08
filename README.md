# my-plants-web

The **Nuxt 3 + Vue 3 frontend** for MyPlants — the UI where the owner sees today's care tasks,
browses their plants, logs actions, reports symptoms, and reads the curated species blogposts.

Nuxt runs as a **server + BFF** (backend-for-frontend): the browser never talks to the NestJS API
directly. All backend calls go through a server-side `/api` proxy, so the API base and the session
secret stay off the client. The UI is built from an **in-house design system** (global CSS tokens
+ Vue wrappers under `components/ui/`); it is bilingual (English + Spanish) via `@nuxtjs/i18n`.

## Where it fits

```
my-plants-species-schema   record-derived types shared with the UI (dependency)
        │
        └── my-plants-web   ← you are here (Nuxt SSR + BFF proxy)
                    │
                    └── proxies to my-plants-api over a server-only base URL
```

Sibling repos:

- [my-plants-species-schema](https://github.com/RetaxMaster/my-plants-species-schema) — shared record types (dependency)
- [my-plants-api](https://github.com/RetaxMaster/my-plants-api) — the backend this app proxies to
- [my-plants-knowledge-engine](https://github.com/RetaxMaster/my-plants-knowledge-engine)

## Requirements

- Node.js 20+
- A running `my-plants-api` instance to proxy to
- The `@retaxmaster/my-plants-species-schema` package (packed tarball)

## Install & configure

```bash
npm install            # postinstall runs `nuxt prepare`
cp .env.example .env    # then edit the values below
```

Environment variables (`.env`):

| Var | Meaning |
|---|---|
| `NUXT_API_BASE` | Internal NestJS API base — **server-only**, never exposed to the browser (dev default `http://localhost:8000`) |
| `NUXT_SESSION_PASSWORD` | Secret that seals the session cookie (must be ≥32 chars). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NUXT_SESSION_MAX_AGE` | Idle ceiling for the sliding session cookie, in seconds (default 30 days) |
| `HOST` / `PORT` | Nitro process binding (production only; unused by `nuxt dev`) |
| `NUXT_PUBLIC_KNOWLEDGE_CHAT_SOCKET_URL` | Public wss endpoint for the admin knowledge-chat (the browser connects here directly) |

## Run

```bash
npm run dev        # nuxt dev (dev server)
npm run build      # nuxt build (production build)
npm run preview    # preview the production build
```

## Verify

`nuxt build` does **not** typecheck. The typecheck gate is separate:

```bash
npm run typecheck  # nuxt typecheck (vue-tsc)
npm run build      # build must also pass
npm test           # vitest
```

## Conventions

- **UI:** reuse wrappers in `components/ui/` before writing markup; visual values come from design
  tokens, never inline magic values. (Tailwind / Nuxt UI is being retired in favor of the in-house
  design system.)
- **API access is centralized** through `composables/useApi.ts`; request/response types live in
  `types/api.ts`. No scattered `$fetch`/`fetch`.
- **i18n:** every user-facing string goes through an i18n key resolved from
  `i18n/locales/{en,es}.json`. Locale is a cookie via `@nuxtjs/i18n` `no_prefix` (never a URL
  prefix).
