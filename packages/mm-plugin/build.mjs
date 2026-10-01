// Bundles each command into dist/commands with everything it needs inlined (viem, @ninety/core),
// so the installed plugin has no runtime dependencies. The one import left external is the host's
// own plugin SDK, which must resolve to the running mm instance.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

function entries(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? entries(path) : path.endsWith(".ts") ? [path] : [];
  });
}

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: entries("src/commands"),
  outdir: "dist/commands",
  outbase: "src/commands",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@metamask/agent-wallet", "@metamask/agent-wallet/*"],
  chunkNames: "../chunks/[name]-[hash]",
  logLevel: "warning",
});
