import { LineItem } from '../types.js';
export { type LineItem };

export function roundFiscal(value: number | string | null | undefined): number {
  // Postgres NUMERIC/DECIMAL columns are returned as strings by node-postgres to
  // preserve precision. Coerce defensively so callers can pipe DB rows in.
  const n = typeof value === "number" ? value : (value == null ? 0 : Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(value);
}

export function calculateLineItemNet(item: LineItem, isVatInclusive: boolean): number {
  if (isVatInclusive) {
    return roundFiscal((item.quantity * item.unit_price) / (1 + item.vat_rate / 100));
  }
  return roundFiscal(item.quantity * item.unit_price);
}

export function calculateLineItemVat(item: LineItem, isVatInclusive: boolean): number {
  const net = calculateLineItemNet(item, isVatInclusive);
  return roundFiscal(net * (item.vat_rate / 100));
}

export function calculateInvoiceTotals(items: LineItem[], isVatInclusive: boolean) {
  let totalNet = 0;
  let totalVat = 0;

  items.forEach(item => {
    totalNet += calculateLineItemNet(item, isVatInclusive);
    totalVat += calculateLineItemVat(item, isVatInclusive);
  });

  return {
    net: roundFiscal(totalNet),
    vat: roundFiscal(totalVat),
    gross: roundFiscal(totalNet + totalVat)
  };
}
