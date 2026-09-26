// Models ignore "no em dashes" often enough that the rule needs a code backstop
// (seen 2026-09-25: "globally—all" in a meta rewrite, an em dash in the Local
// Pack review summary). Same approach as the Content Writer post-process.
//
// 'prose'     : "fast — and cheap" / "fast—and cheap" -> "fast, and cheap"
// 'separator' : for titles, "Stripe — Payments" -> "Stripe - Payments"
// Number ranges with an en dash ("10–20") become "10-20" in both modes.

export function stripDashes(text: string, mode: 'prose' | 'separator' = 'prose'): string {
  if (!text) return text;
  const ranged = text.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2');
  const out = mode === 'separator'
    ? ranged.replace(/\s*[—–]\s*/g, ' - ')
    : ranged.replace(/\s*[—–]\s*/g, ', ');
  return out.replace(/,\s*,/g, ',').replace(/^,\s*/, '');
}
