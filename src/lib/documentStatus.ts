// Kanonische Beleg-Statuswerte — EINE Quelle für Status-Logik (Rechnungen + Angebote).
//
// Grundsatz: Vergleiche (Listenfilter, Zähler, Badges, Schutz-Logik) arbeiten ausschließlich mit
// den kanonischen Werten unten. Legacy-Schreibweisen werden NUR an den Ein-/Ausgabe-Grenzen über
// die Normalisierungsfunktionen umgeschrieben — so kann kein Filter mehr gegen einen Wert
// prüfen, den die Oberfläche nie zu sehen bekommt.
//
// Die Zod-Schemata (src/lib/schemas.ts) und die DB-Zeilen-Aufbereitung (cleanDbRow) nutzen
// dieselben Funktionen; dieses Modul importiert seinerseits nichts aus dem Server-Bereich und ist
// damit auch im Frontend verwendbar.

export const INVOICE_PAYMENT_STATUSES = ['draft', 'issued', 'paid', 'cancelled', 'overdue'] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

export const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'rejected'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

// Legacy-/Fremd-Schreibweisen → kanonischer Wert. Schlüssel immer kleingeschrieben.
const INVOICE_STATUS_ALIASES: Readonly<Record<string, InvoicePaymentStatus>> = {
  pending: 'issued',
  open: 'issued',
  unpaid: 'issued',
  offen: 'issued',
  fällig: 'issued',
  faellig: 'issued',
  ausstehend: 'issued',
  issued: 'issued',
  bezahlt: 'paid',
  beglichen: 'paid',
  paid: 'paid',
  storniert: 'cancelled',
  abgebrochen: 'cancelled',
  cancelled: 'cancelled',
  überfällig: 'overdue',
  ueberfaellig: 'overdue',
  overdue: 'overdue',
  entwurf: 'draft',
  draft: 'draft',
};

const OFFER_STATUS_ALIASES: Readonly<Record<string, OfferStatus>> = {
  not_sent: 'draft',
  angebot_erstellt: 'draft',
  entwurf: 'draft',
  draft: 'draft',
  gesendet: 'sent',
  versendet: 'sent',
  sent: 'sent',
  angenommen: 'accepted',
  bestätigt: 'accepted',
  bestaetigt: 'accepted',
  accepted: 'accepted',
  declined: 'rejected',
  abgelehnt: 'rejected',
  storniert: 'rejected',
  rejected: 'rejected',
};

/**
 * Rechnungs-Status auf den kanonischen Wert abbilden.
 * Unbekannte Werte → `undefined` (Aufrufer behalten so ihre Fehlerbehandlung).
 */
export function normalizeInvoiceStatus(value: unknown): InvoicePaymentStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return INVOICE_STATUS_ALIASES[value.toLowerCase().trim()];
}

/**
 * Angebots-Status auf den kanonischen Wert abbilden.
 * Unbekannte Werte → `undefined`.
 */
export function normalizeOfferStatus(value: unknown): OfferStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return OFFER_STATUS_ALIASES[value.toLowerCase().trim()];
}

/** Kanonischer Status einer Rechnung (auch aus Legacy-Werten). */
export function resolveInvoiceStatus(value: unknown): InvoicePaymentStatus | undefined {
  return typeof value === 'string' && (INVOICE_PAYMENT_STATUSES as readonly string[]).includes(value)
    ? (value as InvoicePaymentStatus)
    : normalizeInvoiceStatus(value);
}

/** Kanonischer Status eines Angebots (auch aus Legacy-Werten). */
export function resolveOfferStatus(value: unknown): OfferStatus | undefined {
  return typeof value === 'string' && (OFFER_STATUSES as readonly string[]).includes(value)
    ? (value as OfferStatus)
    : normalizeOfferStatus(value);
}

/** Offen = noch nicht bezahlt: ausgegeben ODER überfällig (deckungsgleich mit der Übersichtskarte). */
export function isOpenInvoiceStatus(status: unknown): boolean {
  const resolved = resolveInvoiceStatus(status);
  return resolved === 'issued' || resolved === 'overdue';
}

/** Filterwerte der Rechnungsliste: „Offen" bündelt ausgegeben + überfällig. */
export const INVOICE_LIST_FILTERS = ['all', 'draft', 'open', 'paid'] as const;
export type InvoiceListFilter = (typeof INVOICE_LIST_FILTERS)[number];

/** Filterwerte der Angebotsliste (kanonische Statuswerte). */
export const OFFER_LIST_FILTERS = ['all', 'draft', 'sent', 'accepted', 'rejected'] as const;
export type OfferListFilter = (typeof OFFER_LIST_FILTERS)[number];

/** Passt eine Rechnung zum gewählten Listenfilter? Legacy-Werte werden toleriert. */
export function matchesInvoiceListFilter(
  invoice: { payment_status?: unknown } | null | undefined,
  filter: InvoiceListFilter,
): boolean {
  if (filter === 'all') return true;
  const status = resolveInvoiceStatus(invoice?.payment_status);
  if (filter === 'open') return isOpenInvoiceStatus(status);
  return status === filter;
}

/** Passt ein Angebot zum gewählten Listenfilter? Legacy-Werte werden toleriert. */
export function matchesOfferListFilter(
  offer: { offer_status?: unknown } | null | undefined,
  filter: OfferListFilter,
): boolean {
  if (filter === 'all') return true;
  return resolveOfferStatus(offer?.offer_status) === filter;
}

/** Angebote in „angenommen"/„abgelehnt" sind schreibgeschützt (deckungsgleich mit dem Router). */
export function isOfferLockedStatus(status: unknown): boolean {
  const resolved = resolveOfferStatus(status);
  return resolved === 'accepted' || resolved === 'rejected';
}

/** Rechnung gilt als erledigt/gebucht, wenn sie bezahlt ist. */
export function isInvoiceSettledStatus(status: unknown): boolean {
  return resolveInvoiceStatus(status) === 'paid';
}
