// ============================================================================
// Phase 4 (Parität): Fehlerfestigkeit — Fehlerklassifikation
// #33 Schlanke Fehlerklassifikation (Status/Code/Message → Retry-Strategie je Typ).
// NICHT 2000 Zeilen — bewusst schlank (~150), provider-agnostisch.
// Reine, deterministische Funktionen — kein any (Regel 4), testbar.
// ============================================================================

export type ProviderErrorClass =
  | "rate_limit"
  | "auth"
  | "server"
  | "timeout"
  | "invalid_request"
  | "network"
  | "unknown";

export interface RetryStrategy {
  retryable: boolean;
  delayMs: number;
  maxRetries: number;
  hint: string;
}

const RATE_LIMIT_HINTS: RegExp[] = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /429/i,
  /quota/i,
  /insufficient_quota/i
];

const AUTH_HINTS: RegExp[] = [
  /401/i,
  /403/i,
  /unauthorized/i,
  /invalid\s*api\s*key/i,
  /authentication/i,
  /permission\s*denied/i
];

const SERVER_HINTS: RegExp[] = [
  /5\d\d/i,
  /internal\s*server\s*error/i,
  /bad\s*gateway/i,
  /service\s*unavailable/i,
  /502/i,
  /503/i,
  /504/i
];

const TIMEOUT_HINTS: RegExp[] = [
  /timeout/i,
  /timed\s*out/i,
  /etimedout/i,
  /econnaborted/i,
  /deadline/i
];

const INVALID_REQUEST_HINTS: RegExp[] = [
  /400/i,
  /invalid\s*request/i,
  /bad\s*request/i,
  /invalid\s*parameter/i,
  /invalid\s*argument/i,
  /422/i
];

const NETWORK_HINTS: RegExp[] = [
  /econnrefused/i,
  /enotfound/i,
  /ehostunreach/i,
  /network\s*error/i,
  /fetch\s*failed/i,
  /socket/i,
  /unreachable/i
];

/** Klassifiziert einen Provider-Fehler (Error-Message oder roher Status). */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  let message = "";
  let status = 0;
  if (err instanceof Error) {
    message = err.message || "";
  } else if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    message = typeof e.message === "string" ? e.message : "";
    if (typeof e.status === "number") status = e.status;
    if (typeof e.statusCode === "number") status = e.statusCode;
  } else if (typeof err === "string") {
    message = err;
  }
  const text = `${status} ${message}`;

  if (status === 429 || RATE_LIMIT_HINTS.some((re) => re.test(text))) return "rate_limit";
  if (status === 401 || status === 403 || AUTH_HINTS.some((re) => re.test(text))) return "auth";
  if (status >= 500 || SERVER_HINTS.some((re) => re.test(text))) return "server";
  if (TIMEOUT_HINTS.some((re) => re.test(text))) return "timeout";
  if (status === 400 || status === 422 || INVALID_REQUEST_HINTS.some((re) => re.test(text))) return "invalid_request";
  if (NETWORK_HINTS.some((re) => re.test(text))) return "network";
  return "unknown";
}

/** Retry-Strategie je Fehlerklasse (schlank, fail-safe: unbekannt = NICHT retryen). */
export function getRetryStrategy(cls: ProviderErrorClass): RetryStrategy {
  switch (cls) {
    case "rate_limit":
      return { retryable: true, delayMs: 2000, maxRetries: 2, hint: "Rate-Limit: warten und erneut versuchen." };
    case "server":
      return { retryable: true, delayMs: 500, maxRetries: 1, hint: "Serverfehler: 1 Retry." };
    case "timeout":
      return { retryable: true, delayMs: 1000, maxRetries: 1, hint: "Timeout: 1 Retry." };
    case "network":
      return { retryable: true, delayMs: 1500, maxRetries: 2, hint: "Netzwerkfehler: 2 Retries." };
    case "auth":
      return { retryable: false, delayMs: 0, maxRetries: 0, hint: "Auth-Fehler: Konfiguration prüfen — keine automatischen Retries." };
    case "invalid_request":
      return { retryable: false, delayMs: 0, maxRetries: 0, hint: "Ungültige Anfrage: Prompt/Parameter prüfen — keine Retries." };
    case "unknown":
    default:
      return { retryable: false, delayMs: 0, maxRetries: 0, hint: "Unbekannter Fehler: keine automatischen Retries (fail-safe)." };
  }
}
