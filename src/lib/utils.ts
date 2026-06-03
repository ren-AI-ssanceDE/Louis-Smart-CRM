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

