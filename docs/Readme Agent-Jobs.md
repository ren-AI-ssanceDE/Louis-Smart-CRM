# ⏰ Agent-Jobs (Zeitgesteuerte KI-Automatisierung)

> Agent-Jobs sind **automatische „Wachhunde“ und Berichterstatter** in Louis Smart CRM: Sie laufen nach Zeitplan, prüfen Dinge und melden sich nur, wenn es etwas zu sagen gibt. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was sind Agent-Jobs?

Agent-Jobs sind kleine **automatische Helfer**, die nach Zeitplan arbeiten:

| Typ | Was er tut | Beispiel |
|---|---|---|
| **Script-Job** | Führt ein Skript aus und übergibt das Ergebnis an Louis (die KI) zur Auswertung | Täglicher Rechnungs-Report: „3 Rechnungen offen, 1 überfällig, Summe 12.400 €“ |
| **Monitor-Job (Wachhund)** | Prüft etwas regelmäßig und **meldet sich nur, wenn sich etwas geändert hat** | Speicherplatz-Warnung, neue Dateien in der Wissensdatenbank |

## Wozu sind sie gut?

* **Berichte automatisch bekommen:** Jeden Morgen um 08:30 Uhr eine Zusammenfassung der offenen Rechnungen — ohne dass Sie etwas tun.
* **Frühwarnung:** Wenn der Speicherplatz knapp wird oder neue Dokumente eingetroffen sind, erfahren Sie es sofort.
* **KI-Überwachung:** Wenn sich die KI-Konfiguration (z. B. das verwendete Modell) ändert, werden Sie benachrichtigt.

## Wie richte ich einen Job ein? (einfach)

1. **Admin → LOUIS AI → Agent-Jobs** öffnen.
2. **„Neuer Job“** klicken.
3. Wählen:
   * **Zeitplan:** stündlich / täglich (mit Uhrzeit) / wöchentlich (mit Wochentag)
   * **Typ:** Script (führt aus) oder Monitor (meldet nur bei Änderung)
   * **Skript:** z. B. `report_daily_invoices.cjs` (fertige Beispiele sind im System vorhanden)
   * **Zustellung:** „an die Session“ (Louis verarbeitet das Ergebnis und antwortet)
4. Speichern — fertig.

## Das „Stille-Prinzip“

Monitor-Jobs sind **standardmäßig still**: Wenn alles in Ordnung ist, melden sie sich **nicht**. Sie hören also nur dann von ihnen, wenn es wirklich etwas zu melden gibt — kein Nachrichten-Spam.

## Was ist der Unterschied zu Workflows?

* **Workflows** automatisieren **Geschäftsprozesse** (Mahnlauf, Onboarding) mit Freigaben.
* **Agent-Jobs** sind **technische Überwachungs- und Berichtsaufgaben** nach Zeitplan.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Konzept

Ein Agent-Job besteht aus einem **Zeitplan** und einer **Aktion**:

| Typ | Verhalten |
|---|---|
| `script` | Führt ein Script aus; **stdout** wird als Kontext in die Session übernommen (→ Agent-Lauf) |
| `monitor` | Führt ein Script aus; **stdout wird gehasht** — nur bei Änderung startet ein Agent-Lauf mit Diff (klassisches Watchdog-Muster) |

* **Zeitplan**: `hourly` / `daily` (Default `08:30`) / `weekly` (`schedule_weekday`, 1=Mo…7=So)
* **Zustellung**: `deliver_to: session` (Empfehlung für Watchdogs) — der Agent verarbeitet den Script-Output und antwortet; leerer Output = keine Aktion (still)
* **Verwaltung**: Admin → LOUIS AI → **Agent-Jobs** (`src/components/admin/AgentJobsTab.tsx`, Router `agentJobs.ts`: `listAgentJobs`, create/update/toggle/delete)

## 2. Script-Ablage

Agent-Job-Scripte liegen im Arbeitsverzeichnis `louis-scripts/` (wird von `docker-compose.yml` in den Container nach `/app/louis-scripts` gemountet, `LOUIS_AI_SCRIPTS_DIR`). Das Verzeichnis wird beim ersten Start automatisch angelegt; die Scripte werden individuell gepflegt (nicht Teil des öffentlichen Repos).

### Beispiel-Scripte (im Repo enthalten)

| Script | Typ | Zweck |
|---|---|---|
| `watchdog_disk_usage.sh` | `script` | Alarm bei Speicherplatz über Schwelle (still, wenn ok) |
| `watchdog_new_vault_files.sh` | `script` | Meldet neue Dateien in der Wissensdatenbank (24 h) |
| `monitor_ai_config_change.cjs` | `monitor` | Änderungs-Watchdog auf AI-Konfiguration → Agent-Lauf nur bei Änderung |
| `report_daily_invoices.cjs` | `script` | Täglicher Rechnungs-Report (nur Kennzahlen: offen/überfällig/Summe) |
| `report_contacts_quality.cjs` | `script` | Wöchentlicher Datenqualitäts-Report (ohne E-Mail/Firma, Duplikate — nur Zahlen, keine Namen) |

## 3. Regeln für gute Scripte

* **Stiller Output = keine Aktion** (leerer stdout → nichts wird zugestellt)
* Kein Timestamps/Zufallsdaten im Output — sonst wirkt jeder `monitor`-Tick wie eine Änderung
* Laufzeit ≤ 60 s (Scheduler-Timeout), stdout-Limit 4 MB
* Interpreter: `.sh`/`.bash` → bash · `.js`/`.mjs`/`.cjs` → node · `.py` → python3
* **Wichtig:** DB-Zugriff aus Node-Scripts → Datei als **`.cjs`** benennen (das App-`package.json` hat `"type": "module"`; `.js` würde als ESM fehlschlagen)

## 4. Abgrenzung zu Workflows

| | Agent-Jobs | Workflows (DAG) |
|---|---|---|
| Auslöser | Nur Timer/Cron | MANUAL, CRM_EVENT, TIMER |
| Arbeit | Script ausführen / Monitor-Diff | Tool-Ketten (E-Mails, Labels, Notizen, alle Agent-Tools) |
| Ergebnis | Agent verarbeitet Output in Session | Automatisierte Aktionen + Human-Gates |
| Anwendung | Watchdogs, Reports, Config-Überwachung | Geschäftsprozesse (Mahnlauf, Onboarding) |

## 5. Sicherheit & Betrieb

* Scripte laufen im Container (App-Kontext) mit dessen Rechten; Zugriff nur auf gemountete Pfade.
* Fehlgeschlagene Läufe werden geloggt; nicht-still-failing Jobs erzeugen Fehler-Alerts.
* Ergebnisse und Agent-Läufe erscheinen im Audit-Log.
