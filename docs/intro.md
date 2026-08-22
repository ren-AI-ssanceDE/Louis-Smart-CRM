# 🤖 Louis Smart CRM — Einführung

> **Status: produktionsreif** · Letzte Aktualisierung: August 2026

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist Louis Smart CRM?

Louis Smart CRM ist eine **komplette Kunden- und Rechnungsverwaltung mit eingebautem KI-Assistenten** — entwickelt für B2B- und Behörden-Geschäfte (B2G). Das Besondere: Sie können das System nicht nur über Klick-Oberflächen bedienen, sondern auch **in normaler Sprache mit dem KI-Assistenten „Louis“ sprechen oder schreiben**.

Drei Dinge machen Louis Smart CRM besonders:

1. **KI zuerst, Formulare zweitens** — Sie können Louis einfach schreiben, was zu tun ist. Er schlägt vor — Sie geben frei. Ohne Ihre Freigabe wird nichts gespeichert, gebucht oder versendet.
2. **Rechtssichere E-Rechnungen** — Das System erstellt Rechnungen, die den gesetzlichen Anforderungen entsprechen (E-Rechnungspflicht für B2B seit 01.01.2025). Für Behörden gibt es das XRechnung-Format mit Leitweg-ID.
3. **Automatisierung ohne Programmierkenntnisse** — Wiederkehrende Abläufe (z. B. Zahlungserinnerungen) können Sie mit einem **visuellen Baukasten** zusammenstellen: Ereignis („Rechnung überfällig“) → Aktion („Mahnentwurf erstellen“). Die Maschine arbeitet, Sie prüfen und geben frei.

## Für wen ist Louis Smart CRM?

* **Einzelunternehmen & kleine/mittlere Unternehmen**, die Kunden verwalten und rechtskonforme E-Rechnungen stellen müssen.
* **Behördenlieferanten**, die XRechnung mit Leitweg-ID benötigen.
* **Teams ohne Entwickler**, die Prozesse über KI und visuelle Workflows automatisieren möchten — auf Deutsch oder Englisch.

## Gut zu wissen

* **Läuft bei Ihnen lokal** — Ihre Daten bleiben in Ihrem Haus (DSGVO-konform).
* **Kein Risiko durch KI** — Louis kann nicht eigenmächtig handeln: Jede Änderung, jede E-Mail, jede Rechnung wird erst von Ihnen freigegeben (Human-in-the-Loop).
* **Zukunftssicher** — Das System versteht offene KI-Standards (MCP) und kann später mit vielen anderen Tools verbunden werden (z. B. Jira, Google Workspace, eigene Wissensdatenbanken).

---

# 🔧 Teil 2 — Für Entwickler (technische Einführung)

## Systemübersicht & Core-Technologiestack

Louis Smart CRM ist eine enterprise-fähige, KI-native CRM- und E-Invoicing-Plattform mit autonomem ReAct-Agentensystem (Louis AI), Multi-Model-Konsens-Engine (Council), Model Context Protocol Bridge (MCP) sowie konformer ZUGFeRD/Factur-X-E-Rechnungsgenerierung.

* **Client-Layer**: React 19 (Vite, TypeScript), Tailwind CSS v4, Lucide Icons, DnD-Kit, Motion, react-i18next (DE/EN), TanStack React Query v5, @xyflow/react (DAG-Editor)
* **Server-Layer**: Node.js + Express 4 (`server.ts`, Port 3000), tRPC v11, Auth.js (`@auth/express`, `@auth/pg-adapter`), Multer, Nodemailer
* **AI- & LLM-Stack**: `@google/genai` (Gemini), eigener ReAct-Loop (`agentRuntime.ts`), RAG-Engine (pgvector oder In-Memory-Cosine), lokale Modelle via `localModelClient.ts`, DuckDuckGo/Google/SearXNG-Websuche
* **E-Invoicing & PDF**: pdf-lib (+fontkit), pdf-parse, mammoth, juice, custom ZUGFeRD-XML-Builder (`src/lib/zugferd.ts`), Mustangproject CLI (Java)

## Projektprinzipien (verbindlich, per CI erzwungen)

* **Typsicherheit**: TypeScript strict, `any`-Verbot, Zod als Single Source of Truth (`src/lib/schemas.ts`) — durchgesetzt durch automatisierte Code-Gates
* **Kein ORM**: nativer PostgreSQL-Zugriff über `pg` (parametrisierte Queries)
* **Dual-Store-Pflicht**: jede Funktion mit PostgreSQL **und** JSON-Fallback
* **Mandantenfähigkeit**: `tenant_id` auf allen Tabellen/Stores
* **Abwärtskompatibilität**: additive, idempotente Migrationen; Altdaten werden konvertiert, nie gelöscht
* **i18n-Pflicht**: keine hartkodierten UI-Texte (DE/EN)
* **Keine hardcodierten Einstellungen**: Verhaltensparameter in DB-Config + Admin-Panel (NULL = Default)
* **Kritische Systemdateien** (E-Rechnungs-Engine, Docker-Start) sind produktiv abgesichert (Read-Only)

## Projektstruktur (Kurzüberblick)

```
src/
├── pages/            # Dashboard, Companies, Contacts, Invoices, Offers, Kanban, LouisAi, Council, Admin
├── components/       # admin/, dashboard/, layout/, ui/
├── server/
│   ├── routers/      # tRPC-Router (companies, contacts, invoices, offers, louisAi, council, kanban,
│   │                 #   mcpClient, mcpExecution, settings, mailDrafts, filesAndLogs, agentJobs, voice …)
│   ├── ai/           # agentRuntime, critic, orchestrator, workflowEngine, workflowGraphExecutor,
│   │                 #   workflowEventBus, tools/, ragSearch, vaultStore, governance …
│   ├── mcp/          # mcpServer, mcpClientEngine, sdkTransport, serverLifecycle
│   └── council/      # councilEngine, multiModelClient
├── lib/              # schemas.ts (Zod), zugferd.ts, math.ts, dagToolOptions …
├── i18n/locales/     # de.json, en.json
└── types/            # globale Interfaces (inkl. workflows.ts)
services/telegram-bot-gate/   # Telegram-Gateway (MCP-Client)
scripts/                      # Build-Assets (setup-assets, PDFA_def.ps)
docs/                         # Modul-Dokumentation (Anwender & Entwickler)
```

## Weiterführende Dokumentation

Siehe [README.md](README.md) für die vollständige Wiki-Übersicht — von Installation über Architektur bis zu Sicherheit und QA.
