# Ninety — web app

Next.js 16 (App Router), Mera passkeys as the entire account layer. See the root
[README.md](../README.md) for the full project, and `CLAUDE.md` (not committed) for the product
spec this is built against.

```bash
pnpm --filter @ninety/web dev     # also runs the two predev steps below, automatically
```

Two things happen automatically before `dev`/`build` (see `predev`/`prebuild` in `package.json`):

1. **`scripts/link-env.sh`** symlinks the monorepo's one root `.env` in as `.env.local`, since
   Next only auto-loads env files from its own project directory. Not committed; recreated every
   run, so a fresh clone just works once `.env` exists at the repo root.
2. **`pnpm --filter @ninety/core build`** compiles `@ninety/core` to `dist/`. Turbopack resolves
   `@ninety/core`'s own internal `.js`-suffixed imports *literally* (unlike tsc/vitest, which
   substitute `.ts`) — `next.config.ts`'s `resolveAlias` points the bare `@ninety/core` specifier
   at this compiled build specifically for Turbopack, so every other package can keep consuming
   core's live source unaffected. See the doc comment there for the full story.

`NEXT_PUBLIC_RP_ID` fixes the Mera relying-party ID — passkeys bind to it. Leave it unset for
local dev (falls back to `window.location.hostname`); set it once a real deploy domain exists and
never change it after.

The four `NEXT_PUBLIC_<CONTRACT>` addresses in `lib/contracts.ts` fall back to the current live
Monad testnet deployment if unset, so `pnpm build` works with no `.env` at all (this is what lets
CI build the app without secrets). A real redeploy overrides them via the matching env var.
