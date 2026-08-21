# 🤖 Louis Smart CRM

> **Louis Smart CRM** ist eine CRM- und Rechnungssoftware mit eingebautem KI-Assistenten — für kleine und mittlere Unternehmen, die Kundenbeziehungen verwalten, rechtskonforme E-Rechnungen erstellen und Arbeitsabläufe automatisieren möchten.
>
> Letzte Aktualisierung: August 2026 · [Zur Wiki-Übersicht](#-wiki-übersicht)

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist Louis Smart CRM?

Louis Smart CRM ist Ihre **digitale Kunden- und Rechnungsverwaltung** — erweitert um einen **KI-Assistenten („Louis“)**, mit dem Sie per normaler Sprache arbeiten können. Statt viele Formulare auszufüllen, können Sie Louis einfach schreiben:

> *„Lege einen neuen Kontakt für Julia Sommer an, E-Mail julia@sommer.de.“*
> *„Erstelle eine Rechnung an die Acme AG über 5 Stunden Beratung à 150 €.“*
> *„Welche Rechnungen sind aktuell überfällig?“*

Louis versteht die Anweisung, bereitet alles vor — und **fragt Sie um Erlaubnis, bevor etwas gespeichert oder versendet wird**. Sie behalten immer die Kontrolle.

## Was können Sie mit Louis Smart CRM tun?

| Bereich | Was Sie damit machen können |
|---|---|
| **Kunden & Kontakte** | Unternehmen und Ansprechpartner anlegen, pflegen, durchsuchen, importieren |
| **Rechnungen & Angebote** | Belege erstellen, als **rechtskonforme E-Rechnung** (ZUGFeRD/XRechnung) versenden, Zahlungseingänge buchen |
| **Dashboard** | Auf einen Blick: Umsätze, offene Rechnungen, überfällige Posten, Systemstatus |
| **KI-Assistent Louis** | Per Chat oder Sprache das CRM bedienen — Louis schlägt vor, Sie geben frei |
| **Automatisierungen** | Wiederkehrende Abläufe (z. B. Mahnungen) laufen automatisch — mit Freigabe durch Sie |
| **Kanban-Boards** | Aufgaben und Vertriebspipeline als Karten verschieben |
| **Telegram-Zugriff** | Ihr CRM vom Smartphone per Telegram bedienen |
| **Berichte & Analysen** | Umsatz, Datenqualität, offene Posten — als Report oder im Chat nachfragen |

## Wie starte ich?

Am einfachsten starten Sie das komplette System mit einem Befehl (Docker muss installiert sein):

```bash
docker compose up --build -d
```

Danach öffnen Sie im Browser **http://localhost:3000** und melden sich an. Ausführliche Schritt-für-Schritt-Anleitung: [Readme Installation](Readme%20Installation.md).

## Gut zu wissen

* **Ihre Daten bleiben bei Ihnen.** Das System kann komplett lokal auf Ihrem Rechner/Server laufen — DSGVO-konform.
* **Louis kann nicht von alleine handeln.** Jede Änderung an Daten oder jede E-Mail geht erst nach Ihrer Freigabe raus.
* **E-Rechnungen sind rechtssicher.** Die Rechnungs-Engine erfüllt die gesetzlichen Standards (EN 16931, ZUGFeRD, XRechnung) — die Kernkomponenten sind zertifiziert und dürfen nicht verändert werden.
* **Zweisprachig:** Die Oberfläche gibt es auf Deutsch und Englisch.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

[![Tech Stack: TypeScript](https://img.shields.io/badge/Stack-TypeScript%20%2F%20React%20%2F%20Express-blue?style=flat-square)](https://www.typescriptlang.org/)
[![API Protocol: tRPC](https://img.shields.io/badge/API-tRPC%20%2B%20Zod-9b4dca?style=flat-square)](https://trpc.io/)
[![Compliance: EN 16931 & GoBD](https://img.shields.io/badge/Compliance-EN%2016931%20%7C%20GoBD%20%7C%20DSGVO-emerald?style=flat-square)](https://eur-lex.europa.eu/ELI/reg/2016/679/oj)
[![UI: React 19](https://img.shields.io/badge/UI-React%2019%20%2F%20Tailwind%20v4-61dafb?style=flat-square)](https://react.dev/)
[![i18n: DE / EN](https://img.shields.io/badge/i18n-DE%20%2F%20EN-009688?style=flat-square)](https://www.i18next.com/)

**Louis Smart CRM** ist eine hochperformante, typsichere und KI-zentrierte Fullstack-Anwendung: React 19 + Vite + Tailwind v4 (Client), Express 4 + tRPC v11 + Zod (Server), PostgreSQL + pgvector mit JSON-Fallback (Dual-Store), autonomer ReAct-Agent (Louis AI), zertifizierte ZUGFeRD/Factur-X-Engine, DAG-Workflow-Automatisierung, Multi-Model-Council, MCP-Server & -Client.

## Kern-Features (technisch)

* **Louis AI Copilot**: ReAct-Entscheidungsloop, 40+ System-Tools (CRM, RAG/Wissen, Kanban, Templates, Workflows, MCP), QA-Critic, Human-in-the-Loop via `proposedChanges` / einheitlichem Draft-Flow.
* **E-Rechnung**: ZUGFeRD 2.2+ / Factur-X 1.0 Hybrid-PDFs (PDF/A-3b), XRechnung 3.0 (B2G) mit Leitweg-ID-Validierung; zertifizierte, read-only Kernkomponenten.
* **Dualer Speicher-Layer**: PostgreSQL + `pgvector` (1536-dim. Embeddings) oder lokaler JSON-Fallback (`.local_fallback_db.json`) — beide Pfade durch denselben Code bedient.
* **Workflow-Automatisierung**: DAG-Editor (React Flow), Knoten ACTION/CONDITIONAL/WAIT/HUMAN_GATE/RAG/ASK_USER, Trigger MANUAL/CRM_EVENT/TIMER (inkl. 5-Felder-Cron), Dry-Run, Versionierung, Vorlagen.
* **Council Engine**: Multi-Model-/Multi-Rollen-Debatten (Gemini, GPT, Claude, Llama …).
* **MCP**: CRM als MCP-Server (SSE/JSON-RPC, API-Key-Auth) **und** MCP-Client (Tool-Discovery, OAuth, Presets, Namespace `mcp_<server>_<tool>`).
* **Zusätzliche Module**: Angebote, Kanban, Agent-Jobs (Cron-Scripte/Watchdogs), Whisper-STT (Voice), Telegram-Gateway, DSGVO-Tooling (Audit-Log, Export, Löschkonzept), i18n DE/EN.

## Architektur im Überblick

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRÄSENTATION (React 19, Vite, Tailwind v4, i18n DE/EN)              │
│  Dashboard · Unternehmen · Kontakte · Rechnungen · Angebote ·         │
│  Kanban · Louis AI Studio · Council · Admin-Panel                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼ (tRPC v11, voll typsicher via Zod)
┌──────────────────────────────────────────────────────────────────────┐
│  LOGIK (Express 4 + tRPC-Router)                                      │
│  Louis AI ReAct-Loop · QA-Critic · Council Engine · Workflow-Engine   │
│  (DAG-Executor + Scheduler) · MCP-Server & -Client · STT (Voice)      │
└───────────────┬──────────────────────────────────┬───────────────────┘
                ▼                                  ▼
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ PostgreSQL + pgvector          │   │ JSON-Fallback (.local_          │
│ (Embeddings 1536-dim,          │   │ fallback_db.json) — Offline/    │
│  Mandanten-Isolation)          │   │ Entwicklungsmodus               │
└────────────────────────────────┘   └────────────────────────────────┘
```

## Installation & Schnellstart (Kurzfassung)

**Voraussetzungen:** Node.js ≥ 18 (empfohlen 20 LTS), JRE 17+ (nur E-Rechnung), PostgreSQL 14+ mit pgvector — oder JSON-Fallback ohne DB.

```bash
npm install          # Abhängigkeiten + Assets
npm run dev          # Entwicklungsserver auf Port 3000
```

**Docker Compose** (vollständiger Stack: db, app, telegram-bot-gate, whisper, ollama):

```bash
docker compose up --build -d
```

Details: [Readme Installation](Readme%20Installation.md).

## Qualitätssicherung (Gates)

| Gate | Befehl |
|---|---|
| Projektregeln (any-Verbot, i18n, Schutz kritischer Systemdateien) | `npm run check:rules` (pre-commit-Hook) |
| Lint / Typen | `npm run lint` |
| Qualitätssicherung | Interne Test-Suiten (Unit, E2E, ZUGFeRD) — nicht Teil des öffentlichen Repos |
| E2E (Playwright, 20+ Specs) | `npm run test:e2e` |
| ZUGFeRD-E2E | `npm run test:zugferd` |

Details: [Readme Qualitätssicherung & Tests](Readme%20Qualit%C3%A4tssicherung%20%26%20Tests.md).

---

## 📚 Wiki-Übersicht

| Bereich | Dokument |
|---|---|
| **Basis** | [Installation & Deployment](Readme%20Installation.md) · [Systemarchitektur](Readme%20Systemarchitektur.md) · [Tech-Stack & Regeln](Readme%20Tech-Stack.md) · [Datenmodell](Readme%20Datenbank%20%26%20Datenmodell.md) · [i18n & Sprachunterstützung](Readme%20i18n%20%26%20Sprachunterst%C3%BCtzung.md) |
| **CRM-Kern** | [Dashboard](Readme%20Dashboard.md) · [Unternehmen](Readme%20Unternehmen.md) · [Kontakte](Readme%20Kontakte.md) · [E-Rechnung](Readme%20E-Rechnung.md) · [Angebote](Readme%20Angebote.md) · [Kanban](Readme%20Kanban.md) |
| **KI & Automatisierung** | [Louis AI Assistent](Readme%20Louis%20AI%20Assistent.md) · [Workflows & Tools](Readme%20Workflows%20%26%20Tools.md) · [Workflow-Trigger](Readme%20Workflow-Triggers.md) · [Council Engine](Readme%20Council%20Engine.md) · [Agent-Jobs](Readme%20Agent-Jobs.md) |
| **Integrationen** | [MCP (Server & Client)](Readme%20Model%20Context%20Protocol%20(MCP).md) · [Telegram](Readme%20Telegram.md) · [Mailing](Readme%20Mailing.md) · [Sprachsteuerung](Readme%20Sprachsteuerung%20(Voice%20%26%20STT).md) |
| **Betrieb** | [Sicherheit & DSGVO](Readme%20Sicherheit%2C%20Transparenz%20%26%20DSGVO-Compliance.md) · [Vorlagen](Readme%20Vorlagen.md) · [Textgenerierung](Readme%20Textgenerierung.md) · [QA & Tests](Readme%20Qualit%C3%A4tssicherung%20%26%20Tests.md) |
