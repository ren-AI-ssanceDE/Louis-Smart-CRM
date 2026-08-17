// ============================================================================
// S8: Governance-Rules-Engine (Basis aus S5 vervollständigt)
// ----------------------------------------------------------------------------
// Konfigurierbare Regeln pro Tenant (BLOCK / ASK / REQUIRE_APPROVAL / ALLOW)
// als Pre-Tool-Hook vor jedem Write-Tool-Call im ReAct-Loop.
// Deterministische Priorität: BLOCK > ASK > REQUIRE_APPROVAL > ALLOW.
// Keine zutreffende Regel → ALLOW. Fehler → fail-safe REQUIRE_APPROVAL.
// ASK (Rückfrage-Pflicht) wird in S11 mit ask_user_question verdrahtet.
// ============================================================================

import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { GovernanceAction, GovernanceEffect, GovernanceRule } from "../../types.js";

const EFFECT_PRIORITY: Record<GovernanceEffect, number> = {
  BLOCK: 4,
  ASK: 3,
  REQUIRE_APPROVAL: 2,
  ALLOW: 1
};

/**
 * Wertet die aktiven Governance-Regeln für (tenantId, entityType, action) aus.
 * Regel mit entity_type = null gilt für ALLE Entitäten; sonst exakter String-Vergleich.
 * Über alle zutreffenden Regeln falten: die STRENGSTE gewinnt.
 */
export async function evaluateGovernanceRules(
  tenantId: string,
  entityType: string | null,
  action: GovernanceAction
): Promise<{ effect: GovernanceEffect; note: string }> {
  try {
    let rules: GovernanceRule[] = [];

    if (isUsingFallback || !pool) {
      rules = fallbackStore.governanceRules || [];
    } else {
      // Tabelle existiert erst nach S8-DDL — ohne Tabelle keine Regeln → ALLOW
      const tblRes = await pool.query("SELECT to_regclass('sys_louis_ai_governance_rules') AS t");
      if (!tblRes.rows[0] || !tblRes.rows[0].t) {
        return { effect: "ALLOW", note: "" };
      }
      const res = await pool.query(
        `SELECT id_uuid, tenant_id, rule_name, entity_type, action, effect, note, is_active, created_at_utc, updated_at_utc
         FROM sys_louis_ai_governance_rules
         WHERE is_active = TRUE AND (tenant_id = $1 OR tenant_id = '1')`,
        [tenantId]
      );
      rules = res.rows as GovernanceRule[];
    }

    const matching = rules.filter(
      (r) =>
        r.is_active !== false &&
        (r.entity_type === null || r.entity_type === undefined || r.entity_type === entityType) &&
        r.action === action
    );
    if (matching.length === 0) {
      return { effect: "ALLOW", note: "" };
    }

    let strongest = matching[0];
    for (const r of matching) {
      if (EFFECT_PRIORITY[r.effect] > EFFECT_PRIORITY[strongest.effect]) {
        strongest = r;
      }
    }

    return {
      effect: strongest.effect,
      note: String(strongest.note || "")
    };
  } catch (err) {
    console.error("[governance] Evaluierungsfehler — sicherer Default (REQUIRE_APPROVAL):", err);
    return { effect: "REQUIRE_APPROVAL", note: "Governance-Evaluierung fehlgeschlagen — sicherer Default (Freigabepflicht)." };
  }
}
