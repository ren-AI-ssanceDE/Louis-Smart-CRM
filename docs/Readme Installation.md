# 💻 Installation, Systemstart & Deployment

> Dieses Dokument erklärt, wie Sie **Louis Smart CRM** auf Ihrem Rechner oder Server zum Laufen bringen — von den Voraussetzungen bis zum Produktivbetrieb. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was brauche ich?

Für den **einfachsten Weg** (Docker) benötigen Sie nur:

* **Docker** (kostenlos) — damit wird die komplette Software inklusive Datenbank automatisch eingerichtet.
* Einen **Google-Gemini-API-Schlüssel** (optional, aber empfohlen) — für die KI-Funktionen von Louis. Sie erhalten ihn kostenlos über die Google-AI-Studio-Seite.

**Keine Datenbank-Kenntnisse nötig:** Ohne eigene Datenbank startet das System automatisch im „Offline-Modus“ (lokale Speicherung). Für den Testbetrieb ist das völlig ausreichend.

## So starten Sie (in 3 Schritten)

1. **Projektordner öffnen** und einmalig den Befehl ausführen:
   ```bash
   docker compose up --build -d
   ```
   Der Computer lädt und startet jetzt automatisch alle benötigten Bausteine (Datenbank, App, KI-Spracherkennung …). Das dauert beim ersten Mal einige Minuten.

2. **Im Browser öffnen:** `http://localhost:3000`

3. **Anmelden** — fertig! 🎉

## Was Sie im Alltag wissen sollten

* **Wo sind meine Daten?** Standardmäßig auf Ihrem Rechner/Server — in Ordnern neben dem Programm („Daten-Vaults“) und in der Datenbank. Nichts geht automatisch in die Cloud.
* **Was ist der „KI-Schlüssel“?** Ohne Gemini-Schlüssel funktionieren die KI-Funktionen (Chat mit Louis, Textentwürfe) nicht; die restliche Software (Kunden, Rechnungen, Dashboard) arbeitet normal.
* **Wo konfiguriere ich das System?** Nach der Anmeldung im Bereich **„Admin“** — dort finden Sie Einstellungen für E-Mail, Telegram, KI, Spracherkennung und mehr.

> 💡 **Tipp:** Für einen reinen Test ohne Installation gibt es keinen separaten Demo-Zugang — Sie starten das System einfach lokal wie oben beschrieben.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Systemvoraussetzungen

| Komponente | Version | Zweck |
|---|---|---|
| **Node.js** | ≥ 18, empfohlen **20.x LTS** | Laufzeit für Server (tsx) und Build (Vite) |
| **Java Runtime (JRE)** | 17+ (globaler `java`-CLI-Pfad) | Mustangproject CLI für die PDF/A-3b-XML-Verschmelzung (nur E-Rechnungs-Betrieb) |
| **PostgreSQL** | 14+, Erweiterung `pgvector` | Produktionsdatenbank mit Vektor-Embeddings (1536-dim.) |
| **Docker** | aktuell (mit Compose v2) | Empfohlener Produktivbetrieb des Gesamtstacks |

**Keine Datenbank nötig für Entwicklung:** Louis Smart CRM wechselt bei fehlender PostgreSQL-Verbindung automatisch in den lokalen JSON-Fallback-Modus (`.local_fallback_db.json`) — inklusive In-Memory-Vektorsuche.

## 2. Umgebungsvariablen (`.env`)

Kopieren Sie `.env.example` nach `.env` und passen Sie die Werte an:

```env
# KI-Anbindung (Pflicht für AI-Funktionen)
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# Öffentliche URL (für OAuth-Callbacks, MCP, Links)
APP_URL="http://localhost:3000"

# PostgreSQL (produktiv / Docker)
DATABASE_URL=postgres://user:***@localhost:5432/louis_crm
PGHOST=localhost
PGPORT=5432
PGUSER=user
PGPASSWORD=password
PGDATABASE=louis_crm

# Auth.js
AUTH_SECRET=your_auth_secret_here
AUTH_URL=http://localhost:3000
```

> **Wichtig:** Client-Bibliotheken im Frontend nutzen das Präfix `VITE_` (z. B. `VITE_PUBLIC_API_URL`). Sicherheitsrelevante Werte wie `GEMINI_API_KEY` oder `DATABASE_URL` dürfen **niemals** mit `VITE_` deklariert werden — sie würden sonst in den Browser-Bundle gelangen.

## 3. Entwicklungsserver starten

```bash
npm install        # inkl. postinstall: Assets-Setup (scripts/setup-assets.mjs)
npm run dev        # tsx server.ts → Port 3000
```

Der Server läuft standardmäßig auf **Port 3000** (0.0.0.0). Im Terminal wird angezeigt, ob PostgreSQL oder der JSON-Fallback aktiv ist. Für isolierte E2E-Läufe existiert `npm run dev:e2e` (Port **3100**).

## 4. Produktions-Build und Start

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "start": "cross-env NODE_ENV=production tsx server.ts",
    "build": "vite build"
  }
}
```

1. **Frontend bauen:** `npm run build` → statischer Client unter `/dist`.
2. **Fullstack-Server starten:** `npm run start` → Express + tRPC im Produktionsmodus auf Port 3000 mit statischer Auslieferung aus `dist`.

## 5. Betrieb im Docker-Compose-Verbund

```bash
docker compose up --build -d
```

### Dienste

| Dienst | Container | Port | Beschreibung |
|---|---|---|---|
| `db` | `louis-crm-db` | 5432 | PostgreSQL 16 + pgvector (Image `ankane/pgvector`) |
| `app` | `louis-crm-app` | 3000 | Fullstack-Server (Node + JRE), Mounts für Daten-Vaults & Agent-Job-Scripte |
| `telegram-bot-gate` | `louis-telegram-bot-gate` | — | Telegram-Gateway als dezentraler MCP-Client |
| `whisper` | `louis-whisper-server` | 8000 | Speech-to-Text (speaches-ai, OpenAI-kompatible API) |

### Persistente Volumes (GoBD-konform)

* `./companies_data_vault`, `./contacts_data_vault`, `./knowledge_data_vault` — Mandanten-Dateiablagen (werden in den RAG-Vektorspeicher indexiert)
* `./louis-scripts` — Agent-Job-Scripte (wird beim ersten Start automatisch angelegt; individuelle Scripte, nicht Teil des öffentlichen Repos)
* `louis-crm_postgres_data` (externes Volume) und `whisper_models`

## 6. Regeln & Qualitäts-Gates (vor jedem Commit)

```bash
npm run hooks:install   # einmalig: pre-commit-Hook installieren
npm run check:rules     # any-Verbot, i18n-Pflicht, heilige Dateien, additive Migrationen
npm run lint            # tsc --noEmit
npm run lint          # tsc --noEmit (Typprüfung)
npm run test:e2e        # Playwright (E2E-Server :3000/:3100)
npm run test:zugferd    # ZUGFeRD/XRechnung-E2E (scripts/e2e-validate.ts)
```

## 7. Häufige Fehler & Lösungen

| Problem | Lösung |
|---|---|
| `java: command not found` beim PDF-Versand | JRE 17+ installieren und `java` in den PATH aufnehmen |
| App startet im Fallback-Modus | PostgreSQL-Verbindung prüfen (`docker compose ps`, `pg_isready`) |
| `AUTH_SECRET` zu kurz | Mindestens 32 Zeichen verwenden |
| E2E-Server belegt | `npm run dev:e2e` nutzt Port 3100, nicht 3000 |
