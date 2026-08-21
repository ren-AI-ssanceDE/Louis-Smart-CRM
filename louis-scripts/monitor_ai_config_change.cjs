// Monitor (stündlich): Änderungs-Erkennung auf der AI-Konfiguration.
// Output wird gehasht — nur bei ÄNDERUNG (Modell/Provider/Temperatur) läuft ein Agent-Lauf.
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionTimeoutMillis: 8000 });
  await c.connect();
  const { rows } = await c.query(
    `SELECT provider_type, model_name, base_url, temperature, top_p, top_k,
            embedding_provider, embedding_model_name
     FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 LIMIT 1`,
    ["1"]
  );
  const r = rows[0] || {};
  console.log(
    `AI-CONFIG: provider=${r.provider_type || "-"} model=${r.model_name || "-"} temp=${r.temperature ?? "-"} top_p=${r.top_p ?? "-"} embed=${r.embedding_provider || "-"}/${r.embedding_model_name || "-"}`
  );
  await c.end();
})().catch((e) => {
  console.error("AI-CONFIG-FEHLER: " + e.message);
  process.exit(1);
});
