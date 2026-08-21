# louis-scripts — Agent-Job-Scripte (S7/S11)

Dieser Ordner wird in den App-Container nach `/app/louis-scripts` gemountet
(`LOUIS_AI_SCRIPTS_DIR`) und ist damit **persistent über Rebuilds** und
**versioniert im Repo**.

## Verwendung

1. Script hier ablegen (z. B. `watchdog_disk_usage.sh`)
2. Admin → LOUIS AI → **Agent-Jobs** → Neuer Job:
   - `job_type`: `script` (führt Script aus, Output → Session) oder
     `monitor` (Output wird gehasht; nur bei Änderung → Agent-Lauf mit Diff)
   - `script_path`: Dateiname (z. B. `watchdog_disk_usage.sh`) — wird relativ
     zu diesem Ordner aufgelöst
   - `schedule_type`: `hourly` / `daily` / `weekly`
   - `deliver_to`: `session` (Empfehlung für Watchdogs)

## Regeln für gute Scripte

- **Stiller Output = keine Aktion** (leerer stdout → nichts wird zugestellt)
- Output ohne Timestamps/Zufallsdaten, sonst erscheint jeder `monitor`-Tick als Änderung
- Laufzeit ≤ 60 s (Timeout im Scheduler), stdout-Limit 4 MB
- Interpreter: `.sh`/`.bash` → bash, `.js`/`.mjs`/`.cjs` → node, `.py` → python3
- **Wichtig:** DB-Zugriff aus Node-Scripts → Datei als `.cjs` benennen (das App-`package.json` hat `"type": "module"`, `.js` würde als ESM fehlschlagen)

## Beispiele in diesem Ordner

| Script | Typ | Wofür | Einrichtung |
|---|---|---|---|
| `watchdog_disk_usage.sh` | `script` | Alarm bei Speicherplatz > Schwelle (still, wenn ok) | stündlich, deliver_to=session |
| `watchdog_new_vault_files.sh` | `script` | Meldet neue Dateien in der Wissensdatenbank (24 h) | stündlich, deliver_to=session |
| `monitor_ai_config_change.js`→`.cjs` | `monitor` | Änderungs-Watchdog auf AI-Konfig (Modell/Provider/Temp) → Agent-Lauf nur bei Änderung | stündlich, deliver_to=session |
| `report_daily_invoices.cjs` | `script` | Täglicher Rechnungs-Report (nur Kennzahlen: offen/überfällig/Summe) | täglich, deliver_to=session/mail_draft |
| `report_contacts_quality.cjs` | `script` | Wöchentlicher Datenqualitäts-Report (ohne E-Mail/Firma, Duplikate — nur Zahlen, keine Namen) | wöchentlich, deliver_to=session |

> Hinweis: `schedule_type=daily`/`weekly` nutzen `schedule_time` (Default **08:30**). Zum Sofort-Testen `hourly` wählen oder `schedule_time` setzen.
