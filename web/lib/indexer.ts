/**
 * Thin GraphQL client for the Envio indexer (see `indexer/`). Always goes through the app's own
 * `/api/indexer` proxy rather than the indexer's URL: the indexer isn't reachable from a phone or
 * any other device than the one running it, and the proxy is what makes those screens work
 * everywhere. No caching, no batching -- every consumer already wraps this in its own refresh.
 */
export async function queryIndexer<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/indexer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Indexer query failed: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!res.ok || !json.data) {
    throw new Error(`Indexer query failed: HTTP ${res.status}`);
  }
  return json.data;
}
