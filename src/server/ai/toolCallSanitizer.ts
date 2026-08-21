// ============================================================================
// Tool-Call-XML-Sanitizer 
// Entfernt rohe ReAct-/Tool-Call-XML-Blöcke aus finalen Chat-Antworten.
// Hintergrund: DeepSeek-V4 (und andere Provider) liefern im natives Modus teils
// XML-Tool-Calls als Text (<REACT_LOOP_STATE>, <TOOL_CALLS>, <CALL_RESULTS>,
// <parallelToolCalls>) — ohne Sanitizer leakt dieser Innenzustand in die
// Chat-Bubble (F14/F27 im Volltest 2026-08-15).
// Reine Funktionen, kein any (Regel 4).
// ============================================================================

// 2026-08-18: DeepSeek-V4 liefert teils Fullwidth-Konfusionszeichen (﹤ U+FF3C statt <)
// und "DSML"-Pipe-Maskierungen (<||DSML||tool_calls>, </||DSML||parameter>) in XML-Tool-Calls.
// normalizeToolCallText führt beides auf gültiges XML zurück, damit Erkennung/Sanitizer/Parser greifen.
// Hinweis: NUR Pipe-Varianten werden ersetzt — <DSML> (ohne Pipes) bleibt als Tag erhalten,
// damit der Sanitizer es als eigenen Block strippen kann.
export function normalizeToolCallText(t: string): string {
  return t
    .normalize("NFKC")
    .replace(/<\/?\|+DSML\|+/gi, (m) => (m.startsWith("</") ? "</" : "<"));
}

// Komplette, geschlossene Blöcke (non-greedy über verschachtelte Tags)
const CLOSED_BLOCK_PATTERNS: RegExp[] = [
  /<REACT_LOOP_STATE>[\s\S]*?<\/REACT_LOOP_STATE>/gi,
  /<TOOL_CALLS>[\s\S]*?<\/TOOL_CALLS>/gi,
  /<CALL_RESULTS>[\s\S]*?<\/CALL_RESULTS>/gi,
  /<CALL>[\s\S]*?<\/CALL>/gi,
  /<parallelToolCalls>[\s\S]*?<\/parallelToolCalls>/gi,
  // 2026-08-18: DeepSeek-V4 leakt das XML-Tool-Call-Format
  // <tool_calls><invoke name="..."><parameter ...>...</parameter></invoke></tool_calls>
  // als finalen Text — teils kleingeschrieben, mit Attributen oder ohne name-Attribute,
  // teils mit Fullwidth-Konfusionszeichen (NFKC) oder <DSML>/<callTool>-Wrappern.
  /<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi,
  /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi,
  /<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi,
  /<callTool\b[^>]*>[\s\S]*?<\/callTool>/gi,
  /<toolName\b[^>]*>[\s\S]*?<\/toolName>/gi,
  /<toolQuery\b[^>]*>[\s\S]*?<\/toolQuery>/gi,
  /<DSML\b[^>]*>[\s\S]*?<\/DSML>/gi,
  /<function_calls\b[^>]*>[\s\S]*?<\/function_calls>/gi,
  // Hinweis: finalize_response/finalDraftText sind KEINE Block-Patterns — ihr Inhalt ist die
  // eigentliche finale Antwort und bleibt erhalten; nur die Tags entfernt der generische Strip.
  // Tool-Name als Tag mit JSON-Body: <list_invoices>\n{...}\n</list_invoices>
  /<([a-z_][a-z0-9_]*)\s*>\s*\{[\s\S]{0,600}?\}\s*<\/\1>/gi,
];

// Öffnende Marker, die nach dem Block-Stripping noch übrig sein können
// (unbalanciert/abgeschnitten) → alles ab dem Marker entfernen.
const LEFTOVER_MARKER = /<(?:REACT_LOOP_STATE|TOOL_CALLS|CALL_RESULTS|parallelToolCalls|CALL|tool_calls|invoke|parameter|callTool|toolName|toolQuery|DSML|function_calls)\b[^>]*>/i;

// 2026-08-18: Marker-Erkennung für die Auto-Erkennung im Strict-Modus (Text-Fallback-Kanal AUS).
// true, wenn der Text rohe Tool-Call-XML enthält (Leak-Kandidat → Hinweis statt Antwort).
export function containsToolCallXml(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeToolCallText(text);
  return /<(?:tool_calls|TOOL_CALLS|invoke|parameter|REACT_LOOP_STATE|CALL_RESULTS|parallelToolCalls|CALL|callTool|toolName|toolQuery|DSML|finalize_response|finalDraftText|function_calls)\b/i.test(normalized)
    || /<([a-z_][a-z0-9_]*)\s*>\s*\{[\s\S]{0,600}?\}\s*<\/\1>/i.test(normalized)
    // Generischer Schutz: 3+ XML-ähnliche Tags in einer Antwort = Leak-Kandidat (unbekannte Formate)
    || (normalized.match(/<\/?[a-zA-Z_][a-zA-Z0-9_]*(\s[^>]*)?>/g) || []).length >= 3;
}

/**
 * Entfernt rohe Tool-Call-XML-Blöcke aus einem LLM-Antworttext.
 * Behält normalen Text davor/danach. Liefert "" wenn nur XML übrig ist.
 */
export function stripToolCallXml(text: string | null | undefined): string {
  if (!text) return "";
  let out = normalizeToolCallText(text);
  const hadMarkers = containsToolCallXml(out);
  for (const pattern of CLOSED_BLOCK_PATTERNS) {
    out = out.replace(pattern, "");
  }
  const leftover = LEFTOVER_MARKER.exec(out);
  if (leftover) {
    out = out.slice(0, leftover.index);
  }
  // 2026-08-18: Generischer Schutz — falls nach dem Block-Stripping noch XML-ähnliche Tags
  // übrig sind (z.B. <finalize_response><finalDraftText>…</finalDraftText>), Tags entfernen,
  // Inhalt behalten. Nur wenn vorher Leak-Marker erkannt wurden (schützt normale Antworten).
  if (hadMarkers) {
    out = out.replace(/<\/?[a-zA-Z_][a-zA-Z0-9_]*(\s[^>]*)?>/g, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

/**
 * Phase 4 (#34): Thinking-Scrubber (Muster think_scrubber.py:64).
 * Entfernt Reasoning-/Thinking-Blöcke aus Antworten: <thinking>-Tags, markdown-```thinking```-Blöcke,
 * "Thought:"-Zeilen (ReAct-internes Reasoning). Fail-open: nur klare Muster.
 */
const THINKING_BLOCK_PATTERNS: RegExp[] = [
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /```(?:thinking|reasoning)[\s\S]*?```/gi,
  /(?:^|\n)Thought:\s*[^\n]*(\n|$)/gi,
  /(?:^|\n)(?:Reasoning|Analysis):\s*[^\n]*(\n|$)/gi
];

export function stripThinkingBlocks(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const pattern of THINKING_BLOCK_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Phase 4 (#36): Reasoning-Summary-Separation (Muster reasoning_summaries.py:37).
 * Verklebte Reasoning-Blöcke ("Reasoning:\n…\nSummary:\n…") trennen: der letzte substanzielle
 * Abschnitt nach dem letzten Marker ist der eigentliche Inhalt. Fail-open: ohne Marker
 * (oder wenn danach nichts Substanzielles folgt) bleibt der Text unverändert.
 */
const REASONING_SEPARATORS: RegExp[] = [
  /(?:^|\n)(?:Reasoning|Analysis|Summary|Zusammenfassung|Überlegung):\s*$/gim,
  /(?:^|\n)(?:Reasoning|Analysis|Summary|Zusammenfassung|Überlegung):\s*\n/gim
];

export function separateReasoningSummaries(text: string | null | undefined): string {
  if (!text) return "";
  const t = text.trim();
  if (!t) return "";
  // Alle Marker-Positionen sammeln
  const positions: number[] = [];
  for (const re of REASONING_SEPARATORS) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      positions.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (positions.length === 0) return t;
  const lastMarker = Math.max(...positions);
  const after = t.slice(lastMarker).replace(/^(?:Reasoning|Analysis|Summary|Zusammenfassung|Überlegung):\s*/i, "").trim();
  // Nur trennen, wenn nach dem letzten Marker ein substanzieller Inhalt folgt (≥ 40 Zeichen)
  if (after.length >= 40) return after;
  return t;
}

/**
 * Sanitized die finale Antwort und liefert bei leerem Ergebnis eine
 * generische Abschlussmeldung in der Zielsprache.
 */
export function sanitizeFinalText(
  text: string | null | undefined,
  language: string,
  opts?: { enableThinkingScrub?: boolean }
): string {
  let cleaned = stripToolCallXml(text);
 // Phase 4 (#34/#36): Thinking-Scrubber + Reasoning-Separation (Toggle-gesteuert)
  if (opts?.enableThinkingScrub ?? true) {
    cleaned = stripThinkingBlocks(cleaned);
    cleaned = separateReasoningSummaries(cleaned);
  }
  if (!cleaned) {
    return language === "de"
      ? "Anfrage erfolgreich verarbeitet."
      : "Request processed successfully.";
  }
  return cleaned;
}
