// ============================================================================
// Tool-Call-XML-Sanitizer (Auftrag 010, B1)
// Entfernt rohe ReAct-/Tool-Call-XML-Blöcke aus finalen Chat-Antworten.
// Hintergrund: DeepSeek-V4 (und andere Provider) liefern im natives Modus teils
// XML-Tool-Calls als Text (<REACT_LOOP_STATE>, <TOOL_CALLS>, <CALL_RESULTS>,
// <parallelToolCalls>) — ohne Sanitizer leakt dieser Innenzustand in die
// Chat-Bubble (F14/F27 im Volltest 2026-08-15).
// Reine Funktionen, kein any (Regel 4).
// ============================================================================

// Komplette, geschlossene Blöcke (non-greedy über verschachtelte Tags)
const CLOSED_BLOCK_PATTERNS: RegExp[] = [
  /<REACT_LOOP_STATE>[\s\S]*?<\/REACT_LOOP_STATE>/gi,
  /<TOOL_CALLS>[\s\S]*?<\/TOOL_CALLS>/gi,
  /<CALL_RESULTS>[\s\S]*?<\/CALL_RESULTS>/gi,
  /<CALL>[\s\S]*?<\/CALL>/gi,
  /<parallelToolCalls>[\s\S]*?<\/parallelToolCalls>/gi,
  // 2026-08-18 (Stefan-Live-Befund): DeepSeek-V4 leakt das XML-Tool-Call-Format
  // <tool_calls><invoke name="..."><parameter ...>...</parameter></invoke></tool_calls>
  // als finalen Text — teils kleingeschrieben, mit Attributen oder ohne name-Attribute.
  // Vorher Lücke: nur exaktes <TOOL_CALLS> ohne Attribute + kein <invoke>/<parameter> → roher Block in der Bubble.
  /<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi,
  /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi,
  /<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi,
];

// Öffnende Marker, die nach dem Block-Stripping noch übrig sein können
// (unbalanciert/abgeschnitten) → alles ab dem Marker entfernen.
const LEFTOVER_MARKER = /<(?:REACT_LOOP_STATE|TOOL_CALLS|CALL_RESULTS|parallelToolCalls|CALL|tool_calls|invoke|parameter)\b[^>]*>/i;

/**
 * Entfernt rohe Tool-Call-XML-Blöcke aus einem LLM-Antworttext.
 * Behält normalen Text davor/danach. Liefert "" wenn nur XML übrig ist.
 */
export function stripToolCallXml(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const pattern of CLOSED_BLOCK_PATTERNS) {
    out = out.replace(pattern, "");
  }
  const leftover = LEFTOVER_MARKER.exec(out);
  if (leftover) {
    out = out.slice(0, leftover.index);
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

/**
 * Sanitized die finale Antwort und liefert bei leerem Ergebnis eine
 * generische Abschlussmeldung in der Zielsprache.
 */
export function sanitizeFinalText(
  text: string | null | undefined,
  language: string
): string {
  const cleaned = stripToolCallXml(text);
  if (!cleaned) {
    return language === "de"
      ? "Anfrage erfolgreich verarbeitet."
      : "Request processed successfully.";
  }
  return cleaned;
}
