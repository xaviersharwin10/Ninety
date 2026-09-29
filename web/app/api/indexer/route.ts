/**
 * Read-only proxy to the Envio indexer's GraphQL endpoint.
 *
 * The browser can't reach the indexer directly: it runs next to the other services (Hasura on
 * :8080), and a phone opening the app over a tunnel has no route to that. Forwarding from the server
 * keeps the indexer's own URL server-side and lets every screen that reads it -- My Bets, the
 * leaderboard, vault history -- work from any device the app itself works on.
 *
 * Queries only. The indexer is written to exclusively by its own event handlers; nothing here
 * should ever be able to change it.
 */
const UPSTREAM = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL;

export async function POST(request: Request) {
  if (!UPSTREAM) {
    return Response.json({ errors: [{ message: "indexer_not_configured" }] }, { status: 503 });
  }

  let body: { query?: unknown; variables?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: [{ message: "invalid_body" }] }, { status: 400 });
  }
  if (typeof body.query !== "string" || /\b(mutation|subscription)\b/i.test(body.query)) {
    return Response.json({ errors: [{ message: "queries_only" }] }, { status: 400 });
  }

  try {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: body.query, variables: body.variables ?? {} }),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json({ errors: [{ message: "indexer_unreachable" }] }, { status: 502 });
  }
}
