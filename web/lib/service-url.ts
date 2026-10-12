/**
 * Where the match-data and quote-relay services live. Locally each has its own port and the
 * settings are full URLs. Hosted, both sit behind the app's own address under a path ("/md",
 * "/relay"), so the same build works on any hostname: the browser fills in the address it was
 * loaded from, and the app's server, which shares a machine with them, uses the internal one.
 */
export function serviceUrl(configured: string, internal: string, scheme: "http" | "ws"): string {
  if (!configured.startsWith("/")) return configured;
  if (typeof window === "undefined") return internal;
  return `${window.location.origin.replace(/^http/, scheme)}${configured}`;
}
