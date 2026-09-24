const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL;

/**
 * Thin GraphQL client for the Envio indexer (see `indexer/`). No caching, no batching -- the
 * indexer is local/fast and every consumer already wraps this in its own hook-level refresh.
 */
export async function queryIndexer<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!INDEXER_URL) {
    throw new Error("NEXT_PUBLIC_INDEXER_URL is not set");
  }
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Indexer query failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Indexer query failed: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Indexer query returned no data");
  }
  return json.data;
}
