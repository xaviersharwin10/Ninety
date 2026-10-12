/**
 * An agent's one-line read of the match, shown on the Agents page. It is signed with the agent's
 * quote-signing key, so the page can check it came from that agent and not from whoever can reach
 * the relay it's posted to.
 */
export interface AgentNote {
  agentId: number;
  note: string;
  /** When it was written, ms since the epoch. */
  at: number;
  signature: `0x${string}`;
}

/** The exact text an agent signs for a note. */
export function agentNoteMessage(note: Pick<AgentNote, "agentId" | "note" | "at">): string {
  return `Ninety agent ${note.agentId} at ${note.at}: ${note.note}`;
}
