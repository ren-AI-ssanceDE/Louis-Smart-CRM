// Projektarbeit: Bedingungs-Filter für CRM_EVENT-Workflow-Trigger (P0-2).
// Reine, exportierte Funktion — deterministisch, providerneutral, testbar.
// UND-Semantik: ALLE Bedingungen müssen erfüllt sein; fehlendes Feld im
// Payload → Bedingung false (kein stiller Trigger).

export type EventConditionField =
  | "entity_type" | "entity_id" | "entity_name" | "file_name"
  | "company_id" | "company_name" | "invoice_status" | "kanban_column_id";

export type EventConditionOperator =
  | "equals" | "not_equals" | "contains" | "starts_with" | "ends_with";

export interface EventCondition {
  field: EventConditionField;
  operator: EventConditionOperator;
  value: string;
}

/**
 * Prüft, ob ein angereicherter Event-Payload die Bedingungen erfüllt.
 * - Keine Bedingungen → true (Altverhalten: Event-Name-Match genügt).
 * - Verknüpfung: logic='AND' (Default) = ALLE Bedingungen
 *   erfüllt; logic='OR' = MINDESTENS EINE erfüllt.
 * - Fehlendes/leeres Feld im Payload → Bedingung false (kein stiller Trigger).
 * - not_equals: true wenn Feld vorhanden UND !== value (fehlendes Feld → false).
 */
export function matchesEventConditions(
  conditions: EventCondition[] | undefined | null,
  enrichedData: Record<string, unknown>,
  logic: "AND" | "OR" = "AND"
): boolean {
  if (!conditions || conditions.length === 0) return true;

  const matchesOne = (cond: EventCondition): boolean => {
    const raw = enrichedData[cond.field];
    if (raw === undefined || raw === null) return false;
    const actual = String(raw);

    switch (cond.operator) {
      case "equals":
        return actual === cond.value;
      case "not_equals":
        return actual !== cond.value;
      case "contains":
        return actual.includes(cond.value);
      case "starts_with":
        return actual.startsWith(cond.value);
      case "ends_with":
        return actual.endsWith(cond.value);
      default:
        return false; // unbekannter Operator → kein Trigger
    }
  };

  if (logic === "OR") {
    // Mindestens eine Bedingung erfüllt → true
    return conditions.some(matchesOne);
  }
  // AND (Default): alle Bedingungen erfüllt
  return conditions.every(matchesOne);
}
