# Ninety — web app

Next.js 16 (App Router), Mera passkeys as the entire account layer. See the root
[README.md](../README.md) for the full project, and `CLAUDE.md` (not committed) for the product
spec this is built against.

```bash
pnpm --filter @ninety/web dev
```

`NEXT_PUBLIC_RP_ID` fixes the Mera relying-party ID — passkeys bind to it. Leave it unset for
local dev (falls back to `window.location.hostname`); set it once a real deploy domain exists and
never change it after.
