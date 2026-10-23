// Mailversand-Härtung: Größen-Guard + TLS-Verifikation.
// Reine Funktionen, deterministisch testbar.

export const DEFAULT_MAX_ATTACHMENT_MB = 25;

/**
 * Effektives Größenlimit für E-Mail-Anhänge in Bytes.
 * `max_attachment_mb` NULL/ungesetzt → Default 25 MB (Regel 12: Weiche, kein Hardcode).
 */
export function resolveMaxAttachmentBytes(maxAttachmentMb: number | null | undefined): number {
  const mb = typeof maxAttachmentMb === "number" && maxAttachmentMb > 0
    ? maxAttachmentMb
    : DEFAULT_MAX_ATTACHMENT_MB;
  return mb * 1024 * 1024;
}

/**
 * TLS-Zertifikatsprüfung: verifizierend per Default;
 * `allow_self_signed_tls === true` ist das explizite Opt-out für Self-Signed-Zertifikate.
 */
export function resolveRejectUnauthorized(allowSelfSignedTls: boolean | null | undefined): boolean {
  return allowSelfSignedTls !== true;
}

/**
 * Prüft, ob die Gesamtgröße der Anhänge (Bytes) das Limit überschreitet.
 */
export function exceedsAttachmentLimit(sizes: number[], maxBytes: number): boolean {
  const total = sizes.reduce((sum, s) => sum + (Number.isFinite(s) ? s : 0), 0);
  return total > maxBytes;
}
