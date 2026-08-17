// ============================================================================
// Befund: Bearer-/Basic-Präfix-Filter fehlt (2026-08-17)
// ----------------------------------------------------------------------------
// Nutzer kopieren aus Plugin-UI-Anzeigen oft den kompletten Text
// „Bearer <hex>" statt nur des Hex-Keys → die Engine sendet
// „Authorization: Bearer Bearer <hex>" → 401.
// Lösung: Präfix beim Persistieren (createServer/updateServer/installPreset)
// UND defensiv beim Lesen (getAuthHeaders) entfernen — idempotent, wirkt auch
// für bereits fehlerhaft gespeicherte Tokens (keine Migration nötig).
// ============================================================================

/**
 * Entfernt ein führendes Auth-Scheme-Präfix ("Bearer " / "Basic ") und trimmt.
 * Legitime Secrets beginnen nie mit diesen Wörtern → uneingeschränkt sicher.
 * Idempotent: mehrfache Anwendung ändert nichts.
 */
export function normalizeAuthToken(token: string | null | undefined): string | null | undefined {
  if (!token) return token;
  return token.trim().replace(/^(bearer|basic)\s+/i, "");
}
