# Changelog — Louis Smart CRM

Alle wesentlichen Änderungen pro Version. Format basiert auf [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0] — 2026-08-17

Release der Produktionsreife: vollständige Test- und Validierungsabdeckung (Unit-, E2E-, MCP- und ZUGFeRD-Prüfung), kompletter Docker-Frischstart und abgesicherte Release-Pipeline.

### 🚀 Highlights V2

- **KI-Assistent (Louis AI)**: ReAct-Loop mit nativem Tool-Calling, einheitlicher Draft-Flow mit Freigabe (Human-in-the-Loop), LLM-Kritikschleife bei CRM-Änderungen, XML-Sanitizer für Chat-Antworten, Chat-Datei-Upload mit optionaler Wissensdatenbank-Indizierung, Session-Recall, Memory & Skills, Subtask-Delegation.
- **Workflows**: Visueller DAG-Editor, Vorlagen-Bibliothek, Versionierung, Dry-Run/Simulation, flexible Cron-Trigger, Trigger-Events (Angebot/Kanban/Rechnung), Human-Gates, WAIT-Knoten, Frageschritte und Delegations-Schritte.
- **MCP**: Katalog auf 42 Tools erweitert (Notizen, Vault, Mails, Kanban, Templates, Angebote, Sessions, Workflows), Preset-Katalog mit Admin-Aktivierung, Tenant-Isolation, Streamable-HTTP-Handshake, HTTPS-MCP-Unterstützung, widerrufbare API-Schlüssel.
- **Obsidian-Anbindung**: Vollwertiges Obsidian-MCP über das Local REST API Plugin (Admin-konfigurierbar).
- **E-Rechnung**: ZUGFeRD/XRechnung als PDF/A-3 mit Mustang-Validierungs-Gate (EN 16931) und Ghostscript-Normalisierung.
- **Sicherheit**: Passwort-Hashing auf bcrypt (per-User-Salt, Kostenfaktor 10) mit automatischer Migration bestehender Konten; vollständige MCP-Auditierung (CREATE/UPDATE/DELETE) mit filterbarem und exportierbarem Audit-Log.

### 🐛 Wichtige Fixes (Auswahl)

- **Auth-Sicherheit**: Das Session-Secret wird beim ersten Start generiert und sicher in der Datenbank gespeichert — keine hartkodierten oder bekannten Standardwerte mehr. Alle Konfiguration erfolgt über das Admin-Panel.
- **Workflow-Notizen**: Notiz-Schritte in Workflows speichern Notizen jetzt zuverlässig in der Datenbank (vorher wurden sie nur angekündigt, aber nicht persistiert).
- **Council-Sessions**: Anlegen und Fortsetzen von KI-Deliberationen über den MCP-Kanal funktioniert zuverlässig.
- **Angebots-Finalisierung**: Fehler bei der Belegerstellung mit Datumsfeldern behoben.
- **MCP-Feldnamen**: Feldnamen-Drift bei MCP-Aufrufen behoben (u. a. Rechnungspositionen, Notizen).
- **Robustheit**: Obsidian-Lesezugriff widerstandsfähig gegen fehlerhafte Antworten; XML-Tool-Call-Parsing robuster; Scheduler/WAIT ohne Endlos-Loop.
- **Audit-Konsistenz**: Nur Schreibaktionen (CREATE/UPDATE/DELETE) werden protokolliert; Admin-Usability verbessert (Token-Verbrauch, Agent-Jobs, Governance).
- **Build-Stabilität**: Fonts werden aus dem Build-Kontext bereitgestellt (kein Download zur Build-Zeit).

### 🔧 Infrastruktur

- **Stack**: Docker Compose (App, PostgreSQL + pgvector, Whisper, Telegram-Gate, Ollama) — ein Befehl startet alles, ohne Datei-Editierung (Konfiguration über das Admin-Panel).
- **Qualitäts-Gates**: Automatisierte Projektregeln (kein `any`, i18n-Pflicht DE/EN, Schutz kritischer Systemdateien), TypeScript-Lint, Produktions-Build, umfassende Test-Suiten (interner Entwicklungsprozess).

---

## [1.0.0] — 2026-08-04 (Basis)

Erste veröffentlichte Version: CRM-Grundgerüst (Firmen, Kontakte, Angebote, Rechnungen), KI-Chat, ZUGFeRD-E-Rechnungserzeugung, Docker-Stack. Danach kontinuierliche Funktions- und Qualitätserweiterungen, die in 2.0.0 münden.
