# Changelog — Louis Smart CRM

Alle wesentlichen Änderungen pro Version. Format basiert auf [Keep a Changelog](https://keepachangelog.com/).

## [2.1.10] — 2026-08-29

- **Firmenauflösung in automatisierten Abläufen korrigiert:** Workflows, die eine Firma anhand ihres Namens suchen, funktionieren wieder zuverlässig — die Suche nutzt jetzt das korrekte Namensfeld.

## [2.1.9] — 2026-08-28

- **Anzeigename wird bei Namensänderungen synchron gehalten:** Ändert ihr Vor- oder Nachnamen eines Kontakts, wird der Anzeigename automatisch mitgeführt — in der Oberfläche, über Schnittstellen und in automatisierten Abläufen.
- **Namensfelder vor versehentlicher Überschreibung geschützt:** Ein übergebener Anzeigename kann die Vor-/Nachnamensfelder nicht mehr ungewollt verändern.

## [2.1.8] — 2026-08-28

- **Kontakte über MCP mit allen Feldern anlegen und bearbeiten:** Externe Anbindungen (z. B. KI-Assistenten) können jetzt sämtliche Kontaktdaten übergeben — von Anrede, Adresse und Telefon bis zu Bankdaten, USt-IdNr., Opt-ins und Labels. Bisher gingen weitergehende Angaben verloren.
- **Vollständige Kontaktdaten bei Anlage und Änderung:** Alle Eingaben werden zuverlässig gespeichert — auch verantwortliche Person, Preisliste und weitere Detailfelder.

## [2.1.7] — 2026-08-25

- **Workflow-E-Mails enthalten jetzt den echten Inhalt:** E-Mails aus automatisierten Abläufen (z. B. nach einem Datei-Upload) werden mit dem befüllten Vorlagen-Inhalt erstellt statt mit einer leeren oder fehlerhaften Nachricht — als Entwurf zur Freigabe, sofern kein Sofortversand eingestellt ist.
- **Zuverlässigere Workflow-Ausführung:** Ergebnisse vorheriger Schritte fließen in nachfolgende Schritte ein; Warte- und Bedingungs-Schritte bleiben davon unberührt und laufen exakt wie konfiguriert.
- **Kontakt-Bezüge in Workflows verbessert:** „Lege eine Notiz am Kontakt … an" findet den richtigen Kontakt auch bei ausführlichen Formulierungen.
- **Kleinere UI-Korrektur:** Die Bedingungs-Editoren im Workflow-Formular nutzen die volle Breite — Auswahlfelder zeigen ihre Beschriftung, Eingabefelder laufen nicht mehr über den Rand.

## [2.1.6] — 2026-08-25

### 🎯 Fokus: Stabile Workflows & vollständige Kontrolle über automatisierte Abläufe

#### 📋 Workflow-Liste mit Pagination
* Die Liste der erlernten Workflows ist jetzt paginiert (5/10/20 pro Seite) —
  auch bei vielen Workflows bleiben alle Abläufe sichtbar und auffindbar.

#### 🔒 Keine internen Bezeichnungen mehr im Workflow-Lernen
* Wenn Louis einen Workflow per Chat lernt, wird nur noch eine **saubere,
  verständliche Beschreibung** gespeichert — keine technischen/rohen
  Prompt-Anteile mehr, die den Workflow in der Übersicht unlesbar machten.

#### 🛡️ Workflow-Lernen zuverlässig & ohne Duplikate
* Der Lern-Auftrag per Chat legt den Workflow jetzt **genau einmal** an —
  zuvor konnte Louis den Ablauf zusätzlich ein zweites Mal mit eigenem Namen
  speichern.

#### 🔧 Bedingungen (Trigger-Filter) robuster
* Ungültige Bedingungs-Einträge (z. B. aus früheren Versionen oder
  automatisiert angelegt) werden beim Anzeigen bereinigt — Workflows mit
  solchen Bedingungen **verschwinden nicht mehr** aus der Liste und lassen
  sich wieder bearbeiten.

#### 🧪 Qualität
* Umfangreiche Absicherung aller Workflow-Pfade (Lernen, Trigger, Bedingungen,
  Pagination, Ausführung) in den automatisierten Tests ergänzt.

## [2.1.5] — 2026-08-24

### 🎯 Fokus: Zuverlässige Workflow-Trigger & stabiles Workflow-Lernen

#### ⚡ Datei-Upload-Trigger funktionieren jetzt überall
* Dateien, die direkt über die **Kontakt- oder Firmen-Seite** hochgeladen werden,
  lösen jetzt zuverlässig Workflow-Trigger aus (z. B. „Wenn eine Datei mit dem
  Namen Businessplan hochgeladen wird → …“). Zuvor griff der Trigger nur bei
  einem Teil der Upload-Wege — der direkte Upload in Kontakt/Unternehmen blieb
  stumm.

#### 🤖 Louis lernt Workflows zuverlässig per Chat
* Der Auftrag „Lerne einen Workflow: Wenn … hochgeladen/bezahlt/fällig wird →
  …“ führt jetzt **deterministisch** zum Anlegen des Workflows — unabhängig
  von der Modell-Entscheidung. Zuvor konnte Louis den Auftrag gelegentlich nur
  als Notiz „merken“, ohne den Workflow tatsächlich anzulegen (der Trigger
  fehlte dann).

#### 🧪 Qualität
* E2E-Absicherung für den echten Upload-Pfad ergänzt.

## [2.1.4] — 2026-08-24

### 🎯 Fokus: Präzise Automatisierung (Trigger-Bedingungen, Wissens-Upload) & Testtiefe

#### ⚡ Workflow-Trigger mit Bedingungen
* Ereignis-Trigger lassen sich jetzt **eingrenzen**: Bedingungen wie „Unternehmen gleich X“ oder „Dateiname endet auf .pdf“ bestimmen, wann ein Workflow startet.
* **UND/ODER-Verknüpfung**: Mehrere Bedingungen werden wahlweise mit „alle müssen passen“ (UND) oder „mindestens eine reicht“ (ODER) verbunden.
* Der angereicherte Ereignis-Payload enthält für Uploads zusätzlich die zugeordnete Firma — Bedingungen auf Unternehmensebene funktionieren damit für Kontakt- und Firmen-Dateien gleichermaßen.

#### 🧠 Internes Wissen als Trigger
* Neues Ereignis `knowledge.file_uploaded`: Workflows können auf Uploads **ins interne Wissen** reagieren (z. B. „bei neuer Markdown-Datei eine Notiz anlegen“).

#### 🤖 Louis lernt Workflows mit Triggern
* Louis kann im Chat Workflows **mit Trigger** speichern (z. B. „Wenn eine Datei an die Firma X hochgeladen wird, lege eine Notiz an“) — Ereignis, Bedingungen und Verknüpfung werden übernommen.
* Unstrukturierte Lern-Inputs mit Trigger-Hinweisen („wenn … hochgeladen“, „sobald … bezahlt“) werden automatisch erkannt.

#### 🧪 Qualität
* Mutation-Test-Abdeckung der Authentifizierungs-Logik deutlich erhöht (Zielschwelle von 60 % erreicht) — Login, Token- und Session-Pfade sowie die Schlüsselverwaltung sind jetzt testseitig abgesichert.

## [2.1.3] — 2026-08-22

### 🎯 Fokus: Bedienbarkeit & Konsistenz (Council, E-Mail-Anhänge, Rückfragen)

#### 🗣️ LLM Council: einheitliche Bedienoberfläche
* Die Council-Seite (Multi-LLM-Diskussionsforum) nutzt jetzt durchgängig die CRM-Design-Sprache: Standard-Seitenkopf, einheitliche Karten-, Button- und Eingabestile, wiederverwendete Dialog-Komponente statt eigener Fenster.
* Die Session-Übersicht (vergangene Debatten) bleibt als Seitenleiste erhalten — im gewohnten Look der übrigen Module.
* Redundante Bedienelemente entfernt: ein klarer Einstieg für neue Debatten.

#### 📎 E-Mail-Anhänge: Auswahl per Suche + Drag & Drop
* Die Anhangs-Auswahl im E-Mail-Dialog ist jetzt eine Such-Combobox: Live-Filterung, bereits angehängte Dateien sind markiert, Escape/Outside-Klick schließt die Auswahl.
* Anhänge lassen sich zusätzlich per Drag & Drop direkt in den Dialog ziehen.
* Behoben: Das Auswahl-Dropdown wurde am Dialogrand abgeschnitten und ist jetzt vollständig lesbar.

#### 💬 Rückfragen: Antworten schließen die Frage
* Beantwortet Louis im Chat eine offene Rückfrage (z. B. aus einem Workflow), wird diese automatisch als beantwortet markiert — der Rückfrage-Pool bleibt sauber.

#### 🧪 Qualität
* Test-Suite vollständig grün und reproduzierbar (683 Unit-Tests), deterministische UI-Tests für den Council ergänzt.

## [2.1.2] — 2026-08-21

### 🎯 Fokus: Zuverlässigkeit der KI-Pfade (Vault, Kalender, Tokens, Live-Status)

#### 🐛 Vault-Suche: doppelt-verschachtelte Query behoben
- **Kern-Fix:** Tool-Vertrag korrigiert — `query` ist reiner Freitext (kein „als JSON"-Hinweis mehr), plus modell-agnostischer Query-Unwrap (`normalizeQueryValue`, rekursiv, max. 3 Ebenen) an allen Query-Einstiegen (Vault-Suche/Lesen, Wissenssuche, Session-Recall, CRM-Listen).
- Live verifiziert: Thought-Log zeigt `query: "Willkommen"` statt JSON-im-JSON; Golden-Replay 34/34 mit 0 LLM-Calls (110 Golden-Files neu aufgezeichnet).

#### 🔌 Google Kalender: Wechsel auf den aktiven SOTA-Server
- **Root-Cause:** Das bisherige Paket `mcp-google-calendar` 0.0.5 (seit 03/2025 ungepflegt) lieferte durch eine Zod-4-Inkompatibilität leere Input-Schemas — Terminerstellung scheiterte immer mit HTTP 400.
- **Fix:** Wechsel auf `@cocal/google-calendar-mcp` (aktiv gepflegt, korrekte Schemas, flache Parameter), OAuth-Umstellung (`GOOGLE_CALENDAR_MCP_TOKEN_PATH`), Tool-Suffixe migriert, Namens-Duplikate nach Server-Wechsel werden aktiv-bevorzugt aufgelöst.
- **Ergebnis:** 13 Kalender-Tools mit vollständigen Schemas; Termin anlegen/lesen/bearbeiten/löschen live verifiziert (200 statt 400).

#### ⚡ Token-Verbrauch: Memory-Prefetch-Budget hart durchgesetzt
- Ein 8.000-Zeichen-Memory-Eintrag (inkl. Tracking-URLs) sprengte das Prefetch-Budget und blähte jede Anfrage auf. Budget wird jetzt hart durchgesetzt (Einträge gekürzt statt gesprengt), Riesen-Eintrag bereinigt.
- **Messung:** Termin-Anfrage 91.423 → **35.451 Input-Tokens (-61%)**, Folge-Nachricht 52.899 → **18.297 (-65%)**.

#### 💬 Live-Status im Chat: „Was macht Louis gerade?"
- Während der Antwort zeigt die UI **über dem Eingabefeld**, welches Tool / welcher Workflow / welcher Skill gerade ausgeführt wird („Verwende Tool: vault_search" / „Führe Workflow aus: …" / „Nutzt Skill: …").
- Zusätzlich erscheint in der Nachricht ein **Live-Thought-Block** mit den letzten Denk-Schritten (scrollbar, einklappbar) — nach der Antwort übernimmt der finale Thought-Log.
- Technik: In-Memory-Status-Registry (Referenz auf den Thought-Log, TTL-Cleanup) + tRPC-Endpoint + Polling (~800ms, nur während der Verarbeitung).

### ✅ Qualität & Tests

- Unit-Tests: **668/668** (78 Dateien; +31 seit 2.0.0: Query-Normalisierung, SOTA-Server, Memory-Budget, Live-Status)
- Golden-Replay: 34/34 deterministisch (0 LLM-Calls); MCP-Volltest: Kalender 6/6 grün (SOTA)
- Live-E2E live-status: Status-Zeile + Thought-Block erscheinen/verschwinden korrekt
- Alle Gates: check:rules, lint, pre-commit-Hook grün; heilige Dateien unangetastet

---

# Changelog — Louis Smart CRM

Alle wesentlichen Änderungen pro Version. Format basiert auf [Keep a Changelog](https://keepachangelog.com/).

## [2.1.1] — 2026-08-21

Doku- und Infrastruktur-Pflege nach 2.1.0:

### 📝 Dokumentation
- **README:** Tool-Steuerung über Chatprofile beschrieben (eigene Tools immer verfügbar, externe MCP-Tools pro Profil regelbar — Admin-Freigaben, Session-Override)
- **MCP-Namespace korrigiert:** `mcp_<server>_<tool>` statt `mcp_<server>__<tool>` (Louis-AI- und Systemarchitektur-Readme)
- **README/CHANGELOG/Releases:** interne Verweise entfernt (öffentlicher Stand = nur öffentliche Inhalte)

### 🔧 Infrastruktur
- **PostgreSQL-Volume-Auto-Erkennung:** `npm run setup:volumes` erkennt das vorhandene Volume auf jedem System (kein Umbenennen — Abwärtskompatibilität für alle Installationen); Compose nutzt `POSTGRES_VOLUME` mit `external`-Schutz
- **Watchdog für öffentliches Repo:** automatische Prüfung auf interne Referenzen (still bei Grün, Alarm bei Rot)

## [2.1.0] — 2026-08-21

Weiterentwicklung auf V2-Basis: MCP-Client-Engine (SDK-Umbau), Chatprofile, DAG-Workflow-Reifung und deutlich erweiterte Qualitätsabsicherung.

### 🚀 Highlights

- **MCP-Client-Engine:** Umstellung auf `@modelcontextprotocol/sdk` v1.30 (Subpath-Imports), stabile Fassade `McpClientEngine`; **49 externe Tools** über die Client-Engine getestet — Google Gmail (26), Google Kalender (6), Google Drive (1), Obsidian (16). Unterstützt Streamable-HTTP, SSE und HTTPS mit selbstsignierten Zertifikaten.
- **Chatprofile:** Profil-Auswahl im Chat-Header (Main/Schalter), Admin-Freigaben, Tool-Auswahl pro Profil, Warm-Resume über das Default-Profil, Session-Rotation mit Eltern/Kind-Verkettung.
- **DAG-Workflows:** Human-Gates, WAIT-Knoten mit Scheduler-Resume, `ask_user_question`- und `delegate_subtask`-Schritte, Audit-Trail-Statusbadges, Workflow-Instanzen-Log mit DAG-Visualisierung.
- **KI-Assistent:** Session-Recall mit Volltextsuche (gewichtete `ts_rank` + Recency), Memory & Skills, XML-Tool-Call-Sanitizer, Antwort-Guards, Chat-Datei-Upload mit optionaler Wissensdatenbank-Indizierung.
- **E-Rechnung:** ZUGFeRD/XRechnung als PDF/A-3 (Mustang-Validierungs-Gate, Ghostscript-Normalisierung) — Referenzvalidierung 5/5 Szenarien.

### 🐛 Wichtige Fixes (Auswahl)

- **MCP-SDK-Umbau:** fehlender Root-Export in SDK v1.30 (Subpath-Imports); Raw-Kompatibilitäts-Fallback für Google-Pakete mit `$schema`-Input-Schemas; Hard-Timeouts für stdio/Streaming; `stderr: inherit` gegen Deadlocks.
- **Engine-Fix:** Fehlerbehandlung im ReAct-Loop, deterministische Tool-Auswahl (`getToolByNormalizedName` exakt zuerst).
- **Browser-Dialog-Guard:** neue Dialoge werden serverseitig blockiert (Inline-2-Stufen statt `window.confirm`); Bestand bleibt unangetastet.
- **DB-/Container-Parametrisierung:** `TEST_DB_NAME`/`TEST_APP_CONTAINER`/`TEST_DB_CONTAINER` — Tests laufen gegen den Test-Stack statt gegen eine nicht existierende DB.
- **Login-Race:** deterministisches Auth-Setup (direktes Fill statt Preset-Klick).
- **Stryker-Kontext:** `.stryker-tmp` (Sandbox-Kopien) aus dem Docker-Build-Kontext ausgeschlossen.

### 🔧 Infrastruktur & Tests

- **CI (GitHub Actions, Cloud):** 4 Jobs — Gates (check:rules + lint), Unit-Tests, Stryker (Mutation-Score), E2E (hermetisch + ephemeral inkl. AI-Suiten via Golden-Replay) — grün bei jedem Push.
- **Golden-File-Replay:** AI-Suiten (37 Fälle) deterministisch aus aufgezeichneten LLM-Antworten (0 Provider-Calls im CI); zustandsabhängige Fälle (Session-Recall/Web-Recherche) laufen in der Nightly.
- **Nightly-Regression:** tägliche Komplettsuite gegen den Live-Stack, meldet nur bei Rot.
- **Mutation-Testing:** Stryker mit Baseline-Gate (auth.ts 17,6 %; Ziel ≥ 60 %).

### ⚠️ Bekannte Restrisiken (akzeptiert für 2.1.0)

- Tenant-List-Vektor (`OR tenant_id = '1'`-Muster in Listen-Tools) — offen (Folgearbeit)
- Lokaler-LLM-Subtask-Pfad unter paralleler LLM-Last (Timeout) — bekannte Restlücke
- Gmail-Delete-Scope: Google erlaubt kein hartes Löschen über die API — dokumentiert (Option A)
- `drive_search` (transient) und `obsidian_active_file_get_path` (Umgebung) — dokumentierte Client-Volltest-Hinweise

---

## [2.0.0] — 2026-08-17

Release der Produktionsreife: 103 Commits seit dem V1-Import, abgesichert durch 316 Unit-Tests, Live-E2E (102/103), MCP-Volltest (45/45) und ZUGFeRD-Referenzvalidierung.

### 🚀 Highlights V2

- **KI-Assistent (Louis AI)**: ReAct-Loop mit nativem Tool-Calling (3 Ausgabepfade: strukturierte `tool_calls`, XML-Tool-Calls, JSON-Freitext), einheitlicher Draft-Flow mit Freigabe, LLM-Kritikschleife nur bei CRM-Änderungen, Ankündigungs-Schutz mit Tool-Call-Retry, XML-Sanitizer für Chat-Antworten, Chat-Datei-Upload (5 Dateien, 25 MB, optionale Wissensdatenbank-Indizierung), Session-Recall, Memory & Skills, Subtask-Delegation mit Output-Schemas.
- **Workflows**: DAG als einziger Workflow-Pfad (mit Auto-Migration), visueller DAG-Editor (React Flow), Vorlagen-Bibliothek, Versionierung, Dry-Run/Simulation, 5-Felder-Cron + weekly, Trigger-Events (offer/kanban/invoice), Human-Gates, WAIT-Knoten, `ask_user_question`- und `delegate_subtask`-Schritte.
- **MCP**: Katalog 24 → 42 Tools (Notizen, Vault, Mails, Kanban, Templates, Angebote, Sessions, Workflows), Preset-Katalog mit Admin-Aktivierung und deprecated-Nachfolgern, Tenant-Isolation im Get-Pfad, Streamable-HTTP-Handshake + SSE-Parsing, HTTPS-MCP mit selbstsignierten Zertifikaten, widerrufbare API-Schlüssel.
- **Obsidian-Anbindung**: echtes Obsidian-MCP über das Local REST API Plugin (bearer, Admin-Felder), vaultStore auf Plugin-Tools gemappt, Tier-1-Integration mit Upsert + Skills-Fallback.
- **E-Rechnung**: ZUGFeRD/XRechnung als PDF/A-3 mit Mustang-Validierungs-Gate und Ghostscript-Normalisierung (heilige Datei `src/lib/zugferd.ts`, unangetastet).
- **Sicherheit**: Passwort-Hashing auf bcrypt (per-User-Salt, Kostenfaktor 10) mit Lazy-Migration bestehender Hashes; vollständige MCP-Audit-Pflicht (CREATE/UPDATE/DELETE) mit filterbarem/exportierbarem Audit-Log.

### 🐛 Wichtige Fixes (Auswahl)

- **Auth-Secret in der DB statt Code/Env:** Das Session-Secret wird beim ersten Start generiert und in `sys_app_security` gespeichert — kein hartkodierter Fallback mehr (Regel: keine Einstellungen in Dateien; alle Konfiguration über Admin-Panel/DB).
- **Workflow-Notiz persistiert wirklich:** `create_note_draft`-Schritte im linearen Workflow-Executor und im DAG-Executor (Dispatch `executeCreateNoteDraft` + LLM-Dispatch `CreateNote`) übergeben `bypassApproval=true` — vorher liefen alle drei Pfade als No-Op (nur Draft-Meldung bzw. nur Audit ohne DB-Eintrag). Live verifiziert: Notiz in `sys_louis_ai_notes` (Test Testkunde, `ai_workflow(_dag)`).
- Council-MCP: Session-Upsert (INSERT … ON CONFLICT) — `crm_run_council_deliberation` benutzbar
- Angebots-Finalisierung: „Output validation failed" behoben (ISO-Mapper für pg-Date-Spalten in offers-Router)
- MCP-Mapping-Cluster: `notes_create` persistiert wirklich; Feldnamen-Drift (`invoice_line_items`, `note_id_uuid`, `draft_id_uuid`) behoben + Drift-Guard-Test
- Obsidian-Lesezugriff robust gegen MCP-Fehlerantworten; XML-Tool-Call-Parsing robuster (unvollständige Blöcke, Attribut-Parameter)
- Scheduler/WAIT: kein Endlos-Loop, ISO-Mapper für `execute_at_utc`
- Audit-Konsistenz (nur CREATE/UPDATE/DELETE), Admin-Usability (Token-Verbrauch, Agent-Jobs, Governance)
- 429-Build-Fix: Lato-Fonts aus dem Build-Kontext statt GitHub-Download

### 🔧 Infrastruktur & Tests

- Qualitäts-Gates: `check:rules` (any-Verbot, i18n, **Heilige-Dateien-Guard**), lint, test:unit, build; pre-commit-Hook
- Test-Infra: 316 Unit-Tests, Mock-MCP-Server-Auto-Start (globalSetup), MCP-Volltest 45/45, Live-E2E 102/103 (nur bekannter F24-LLM-Flake), Workflow-QA-Suite
- Stack: Docker Compose (App, DB+pgvector, Whisper, Telegram-Gate, Ollama), lokales LLM devstral-small-2:24b für Coding-Subtasks (Kaltstart-Fix, VRAM-Optimierung)

### ⚠️ Bekannte Restrisiken (akzeptiert für V2)

- Tenant-List-Vektor (`OR tenant_id = '1'`-Muster in Listen-Tools) — offen (Folgearbeit)
- Lokaler-LLM-Subtask-Pfad unter paralleler LLM-Last (Timeout) — bekannte Restlücke
- Workflow-Schritt `create_note_draft` persistiert nicht (No-Op) — Freigabe ausstehend
- Bestands-Ordner `…__ren_ai_ssance_` (trailing `_`, Windows-Mount) — kosmetisch, App findet ihn per ID

---

## [1.0.0] — 2026-08-04 (Basis)

CRM-Grundgerüst (Firmen, Kontakte, Angebote, Rechnungen), Chat mit Google-GenAI, ZUGFeRD-Erzeugung, Docker-Stack. Danach 13 Erweiterungsrunden mit laufenden Funktions- und Qualitätserweiterungen, die in 2.0.0 münden.
