import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compareInvoiceNumbers(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  // Extract 4-digit year (typically 2000-2099)
  const yearA_match = a.match(/\b(20\d{2})\b/);
  const yearB_match = b.match(/\b(20\d{2})\b/);
  const yearA = yearA_match ? parseInt(yearA_match[1], 10) : 0;
  const yearB = yearB_match ? parseInt(yearB_match[1], 10) : 0;

  if (yearA !== yearB) {
    return yearA - yearB;
  }

  // Try to extract the last group of consecutive digits (the sequence number)
  const seqA_match = a.match(/(\d+)(?=\D*$)/);
  const seqB_match = b.match(/(\d+)(?=\D*$)/);
  const seqA = seqA_match ? parseInt(seqA_match[1], 10) : 0;
  const seqB = seqB_match ? parseInt(seqB_match[1], 10) : 0;

  if (seqA !== seqB) {
    return seqA - seqB;
  }

  // Fallback to alphabetical comparison
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface DueDateInvoiceProps {
  payment_status: string;
  metadata?: string | Record<string, unknown> | null;
  due_date?: string | null;
  issue_date?: string | null;
  payment_term?: string | null;
}

export function getDueDateStatus(
  invoice: DueDateInvoiceProps,
  i18nLanguage: string,
  mode: "standard" | "compact" = "standard"
) {
  const isPaidFinalized = (() => {
    if (invoice.payment_status === "paid") return true;
    try {
      const meta = typeof invoice.metadata === "string" 
        ? JSON.parse(invoice.metadata) 
        : (invoice.metadata || {});
      return !!meta.is_finalized;
    } catch (_) {
      return false;
    }
  })();

  let dateStr = invoice.due_date;
  if (!dateStr && invoice.issue_date) {
    const days = parseInt(invoice.payment_term || "14", 10);
    if (!isNaN(days)) {
      const d = new Date(invoice.issue_date);
      d.setDate(d.getDate() + days);
      dateStr = d.toISOString().split("T")[0];
    }
  }

  const formatted = dateStr ? new Date(dateStr).toLocaleDateString(i18nLanguage) : "—";

  if (isPaidFinalized) {
    return {
      formatted: formatted !== "—" ? formatted : "—",
      badgeClasses: mode === "compact"
        ? "bg-slate-500/10 text-slate-400 border border-slate-500/25 px-2.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold font-mono"
        : "bg-slate-500/10 text-slate-400 border border-slate-500/25 px-2.5 py-0.5 rounded-lg font-bold font-mono"
    };
  }

  if (!dateStr) return { formatted: "—", badgeClasses: "text-slate-400" };

  const dueDate = new Date(dateStr);
  const today = new Date();
  
  const dMidnight = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const tMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  const diffTime = dMidnight.getTime() - tMidnight.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let badgeClasses = "";

  if (diffDays < 0) {
    badgeClasses = mode === "compact"
      ? "bg-rose-500/10 text-rose-450 border border-rose-500/25 px-2.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold font-mono"
      : "bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2.5 py-0.5 rounded-lg font-bold font-mono";
  } else if (diffDays <= 7) {
    badgeClasses = mode === "compact"
      ? "bg-amber-500/10 text-amber-450 border border-amber-500/25 px-2.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold font-mono"
      : "bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-lg font-bold font-mono";
  } else {
    badgeClasses = mode === "compact"
      ? "bg-emerald-500/10 text-emerald-450 border border-emerald-500/25 px-2.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold font-mono"
      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-0.5 rounded-lg font-bold font-mono";
  }

  return { formatted, badgeClasses };
}

export interface PaymentMethodOption {
  value: string;
  labelKey: string;
  fallback: string;
}

export const PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  { value: "transfer", labelKey: "invoices:finalize.methods.transfer", fallback: "Überweisung" },
  { value: "cash", labelKey: "invoices:finalize.methods.cash", fallback: "Barzahlung" },
  { value: "card", labelKey: "invoices:finalize.methods.card", fallback: "Kartenzahlung (EC/Kreditkarte)" },
  { value: "direct_debit", labelKey: "invoices:finalize.methods.direct_debit", fallback: "Lastschrift" },
  { value: "paypal", labelKey: "invoices:finalize.methods.paypal", fallback: "PayPal" },
  { value: "other", labelKey: "invoices:finalize.methods.other", fallback: "Sonstige" }
] as const;

export function formatValidationErrors(
  errorMsg: string,
  t?: (
    key: string,
    options?: {
      defaultValue?: string;
      minimum?: number | string;
      maximum?: number | string;
      [key: string]: unknown;
    }
  ) => string
): string {
  if (!errorMsg) return "";

  const trimmed = errorMsg.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const issues = JSON.parse(trimmed) as Array<{
        code: string;
        path: Array<string | number>;
        message?: string;
        minimum?: number;
        maximum?: number;
        exact?: boolean;
        validation?: string;
        [key: string]: unknown;
      }>;

      if (Array.isArray(issues) && issues.length > 0) {
        const formatted = issues.map(issue => {
          const pathName = issue.path.join(".");
          let fieldLabel = pathName;

          if (t) {
            const possibleKeys = [
              `validation_errors:fields.${pathName}`,
              `fields:${pathName}`,
              `my_company:${pathName}`,
              `companies:${pathName}`,
              `contacts:${pathName}`,
              `common:fields.${pathName}`,
              `common:${pathName}`
            ];

            for (const key of possibleKeys) {
              const translated = t(key, { defaultValue: "" });
              if (
                translated &&
                translated !== key &&
                !translated.startsWith("validation_errors:") &&
                !translated.startsWith("fields:") &&
                !translated.startsWith("my_company:") &&
                !translated.startsWith("companies:") &&
                !translated.startsWith("contacts:") &&
                !translated.startsWith("common:")
              ) {
                fieldLabel = translated;
                break;
              }
            }
          }

          if (fieldLabel === pathName) {
            const germanFields: Record<string, string> = {
              "country_code": "Ländercode",
              "full_legal_name": "Name des Unternehmens",
              "short_code": "Kürzel",
              "tax_vat_id": "USt-IdNr.",
              "tax_number": "Steuernummer",
              "responsible_person": "Ansprechpartner",
              "street": "Straße",
              "house_number": "Hausnummer",
              "postal_code": "Postleitzahl",
              "city": "Ort",
              "email_address": "E-Mail-Adresse",
              "email_2": "Alternative E-Mail-Adresse",
              "website": "Webseite",
              "phone_number": "Telefonnummer",
              "mobile_number": "Mobilnummer",
              "fax_number": "Faxnummer",
              "iban": "IBAN",
              "bic_swift": "BIC/SWIFT",
              "bank_name": "Bankname",
              "leitweg_id": "Leitweg-ID",
              "vat_rate": "Mehrwertsteuersatz",
              "currency_code": "Währungscode",
              "language": "Sprache",
              "first_name": "Vorname",
              "last_name": "Nachname",
              "salutation": "Anrede",
              "gender_identity": "Geschlecht",
              "date_of_birth": "Geburtsdatum",
              "region": "Region",
              "invoice_number_prefix": "Rechnungs-Präfix",
              "invoice_number_next_seq": "Nächste Rechnungsnummer",
              "invoice_number_min_digits": "Mindeststellen Rechnungsnummer",
              "offer_number_prefix": "Angebots-Präfix",
              "offer_number_next_seq": "Nächste Angebotsnummer",
              "offer_number_min_digits": "Mindeststellen Angebotsnummer"
            };
            if (germanFields[pathName]) {
              fieldLabel = germanFields[pathName];
            }
          }

          let errorText = issue.message || "Ungültiger Wert";

          if (t) {
            let foundTranslation = false;

            if (issue.message) {
              const possibleMsgKeys = [
                `validation_errors:${issue.message}`,
                `common:${issue.message}`,
                `contacts:${issue.message}`,
                `companies:${issue.message}`,
                `admin:${issue.message}`
              ];
              for (const key of possibleMsgKeys) {
                const translatedCustom = t(key, { defaultValue: "" });
                if (translatedCustom && translatedCustom !== key) {
                  errorText = translatedCustom;
                  foundTranslation = true;
                  break;
                }
              }
            }

            if (!foundTranslation) {
              if (issue.code === "invalid_string" && issue.validation === "email") {
                errorText = t("validation_errors:invalid_email", { defaultValue: "Ungültige E-Mail-Adresse" });
              } else if (issue.code === "invalid_string" && issue.validation === "url") {
                errorText = t("validation_errors:invalid_url", { defaultValue: "Ungültige URL" });
              } else if (issue.code === "too_small") {
                errorText = t("validation_errors:too_small", {
                  defaultValue: `Zu kurz (erwartet mindestens ${issue.minimum} Zeichen)`,
                  minimum: issue.minimum !== undefined ? issue.minimum : 2
                });
              } else if (issue.code === "too_big") {
                errorText = t("validation_errors:too_big", {
                  defaultValue: `Zu lang (erwartet maximal ${issue.maximum} Zeichen)`,
                  maximum: issue.maximum !== undefined ? issue.maximum : 255
                });
              } else {
                const codeKey = `validation_errors:${issue.code}`;
                const translatedCode = t(codeKey, {
                  defaultValue: "",
                  minimum: issue.minimum !== undefined ? issue.minimum : "",
                  maximum: issue.maximum !== undefined ? issue.maximum : ""
                });
                if (translatedCode && translatedCode !== codeKey) {
                  errorText = translatedCode;
                }
              }
            }
          } else {
            if (issue.code === "too_small") {
              errorText = `Zu kurz (erwartet mindestens ${issue.minimum} Zeichen)`;
            } else if (issue.code === "too_big") {
              errorText = `Zu lang (erwartet maximal ${issue.maximum} Zeichen)`;
            } else if (issue.code === "invalid_string" && issue.validation === "email" || issue.message === "invalid_email") {
              errorText = "Ungültige E-Mail-Adresse";
            } else if (issue.code === "invalid_string" && issue.validation === "url") {
              errorText = "Ungültige URL";
            } else if (issue.code === "invalid_type") {
              errorText = "Falscher Datentyp oder leerer Wert";
            }
          }

          return `${fieldLabel}: ${errorText}`;
        });

        return formatted.join(", ");
      }
    } catch (_) {}
  }

  if (t) {
    const translatedMsg = t(`error_messages.${errorMsg}`, { defaultValue: "" });
    if (translatedMsg && translatedMsg !== `error_messages.${errorMsg}`) return translatedMsg;
  }

  const staticErrors: Record<string, string> = {
    "concurrency_conflict": "Gleichzeitiger Bearbeitungskonflikt: Ein anderer Benutzer hat diesen Datensatz geändert. Bitte laden Sie die Seite neu.",
    "UNAUTHORIZED": "Authentifizierung erforderlich.",
    "FORBIDDEN": "Zutritt verweigert: Keine Berechtigung."
  };

  if (staticErrors[errorMsg]) {
    return staticErrors[errorMsg];
  }

  return errorMsg;
}

export async function downloadFileFromUrl(url: string, defaultFilename?: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with status: ${response.status}`);
    }

    let filename = defaultFilename || 'download';
    const disposition = response.headers.get('Content-Disposition');
    if (disposition) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;"]+|\"[^\"]+\")/i);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1].replace(/^\"|\"$/g, ''));
      }
    } else if (!defaultFilename) {
      const urlParts = url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart && !lastPart.includes('?')) {
        filename = decodeURIComponent(lastPart);
      }
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Download error:', err);
    throw err;
  }
}

