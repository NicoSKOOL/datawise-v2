// Chat history windows must be the most RECENT N messages in chronological
// order. A plain `ORDER BY created_at ASC LIMIT N` silently returns the
// OLDEST N once a conversation exceeds N messages (bug ae77a909: the
// interview re-asked answered questions; the same window shape in finalize
// drops the newest answers from the generated document). created_at has
// second resolution, so rowid tiebreaks same-second inserts.
export function recentHistorySql(limit: number): string {
  const n = Math.max(1, Math.floor(limit));
  return `SELECT role, content FROM (
      SELECT role, content, created_at, rowid AS rid FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ${n}
    ) ORDER BY created_at ASC, rid ASC`;
}
