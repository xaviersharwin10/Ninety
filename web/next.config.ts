import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ninety/core's source imports its own files with explicit ".js" specifiers (the standard
  // ESM/NodeNext convention, needed so tsx and plain Node can run the other packages that consume
  // it directly), but Turbopack resolves an explicit ".js" specifier literally rather than
  // substituting ".ts" the way tsc/vitest do -- confirmed directly: every one of core's internal
  // relative imports 404s under Turbopack even with transpilePackages set. Pointing the bare
  // specifier at core's own compiled dist/ (a real build step, `pnpm --filter @ninety/core build`,
  // wired into predev/prebuild below) sidesteps the whole ambiguity: every ".js" import in the
  // compiled output resolves to a real ".js" file on disk, which needs no bundler-specific magic
  // at all. Other packages keep consuming core's live source unaffected -- only this alias changes.
  turbopack: {
    resolveAlias: {
      "@ninety/core": "../packages/core/dist/index.js",
    },
  },
  // Phone testing goes through a temporary Cloudflare quick tunnel (random subdomain each run),
  // not localhost -- without this, dev-only cross-origin requests (HMR) are blocked by default.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
