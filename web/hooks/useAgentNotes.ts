"use client";

import { type AgentNote, agentNoteMessage } from "@ninety/core";
import { useEffect, useState } from "react";
import { type Address, verifyMessage } from "viem";
import { RELAY_HTTP_URL } from "@/lib/quote-relay";

const POLL_MS = 15_000;

/**
 * Each agent's latest read of the match, for the ones that publish one (Pulse's is an LLM's). A
 * note is shown only if it's signed by the agent's registered quote-signing key: the relay it comes
 * through takes posts from anyone.
 */
export function useAgentNotes(
  agents: readonly { agentId: number; quoteSigner: Address }[] | null | undefined,
): Map<number, AgentNote> {
  const [notes, setNotes] = useState<Map<number, AgentNote>>(new Map());
  // Just the signers, as a string: `agents` is a new array on every refresh.
  const signers = (agents ?? []).map((a) => `${a.agentId}:${a.quoteSigner}`).join(",");

  useEffect(() => {
    if (!signers) return;
    const signerOf = new Map(
      signers.split(",").map((s) => {
        const [id, signer] = s.split(":");
        return [Number(id), signer as Address];
      }),
    );
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${RELAY_HTTP_URL}/agent-notes`);
        if (!res.ok) return;
        const body = (await res.json()) as { notes: AgentNote[] };
        const genuine = new Map<number, AgentNote>();
        for (const note of body.notes) {
          const address = signerOf.get(note.agentId);
          if (!address) continue;
          const ok = await verifyMessage({
            address,
            message: agentNoteMessage(note),
            signature: note.signature,
          }).catch(() => false);
          if (ok) genuine.set(note.agentId, note);
        }
        if (!cancelled) setNotes(genuine);
      } catch {
        // No notes is a fine thing to show.
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [signers]);

  return notes;
}
