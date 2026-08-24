// Token-Zerlegung: Token-Zerlegung je LLM-Call — deterministische Schätzung der
// Prompt-Bestandteile (System-Prompt, History, Tool-Schemata, Tool-Ergebnisse,
// User-Message). Providerneutral (Regel 11): KEIN LLM-basiertes Zählen, nur
// Zeichen-basierte Heuristik. Echte Werte kommen aus usageMetadata; die
// Zerlegung zeigt die ANTEILE (welche Komponente dominiert).

/** Deterministische Token-Schätzung: 4 Zeichen ≈ 1 Token (bewährte Heuristik). */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

export interface PromptTokensBreakdown {
  system_prompt: number;
  history: number;
  tool_schemas: number;
  tool_results: number;
  user_message: number;
  other: number;
  /** Summe der geschätzten Anteile (≈ echte input_tokens aus usageMetadata). */
  estimated_total: number;
}

export interface BreakdownInput {
  systemInstruction?: string | null;
  optimizedHistory?: string | null;
  nativeToolDecls?: unknown[] | null;
  dynamicPayload?: string | null;
  userMessage?: string | null;
  toolResultsText?: string | null;
}

/**
 * Zerlegt den an den Provider gesendeten Prompt in seine Bestandteile.
 * systemInstruction = Kontext-Teil (OHNE History, die separat gezählt wird);
 * dynamicPayload enthält REACT_LOOP_STATE + Tool-Ergebnisse + User-Query.
 * Die Anteile sind Schätzungen — die Summe dient als Plausibilitäts-Check
 * gegen die echten input_tokens (usageMetadata), nicht als exakte Zählung.
 */
export function buildPromptTokensBreakdown(input: BreakdownInput): PromptTokensBreakdown {
  const systemInstruction = input.systemInstruction || "";
  const history = input.optimizedHistory || "";
  const dynamicPayload = input.dynamicPayload || "";
  const userMessage = input.userMessage || "";
  const toolResultsText = input.toolResultsText || "";

  // System-Prompt: Kontext-Anweisung MINUS History-Anteil (wenn History im
  // systemInstruction-String enthalten ist — wird separat gemessen).
  const historyInInstruction = history.length > 0 && systemInstruction.includes(history.slice(0, 80));
  const systemPromptText = historyInInstruction
    ? systemInstruction.slice(0, Math.max(0, systemInstruction.length - history.length))
    : systemInstruction;

  const system_prompt = estimateTokens(systemPromptText);
  const historyTokens = estimateTokens(history);
  const tool_schemas = estimateTokens(JSON.stringify(input.nativeToolDecls || []));
  const tool_results = estimateTokens(toolResultsText);
  const user_message = estimateTokens(userMessage);

  // "other": Anteile des dynamicPayload, die weder Tool-Ergebnisse noch
  // User-Message sind (REACT_LOOP_STATE, Direktiven, Steering).
  const payloadOther = Math.max(0, estimateTokens(dynamicPayload) - tool_results - user_message);

  const other = payloadOther;
  const estimated_total = system_prompt + historyTokens + tool_schemas + tool_results + user_message + other;

  return {
    system_prompt,
    history: historyTokens,
    tool_schemas,
    tool_results,
    user_message,
    other,
    estimated_total
  };
}
