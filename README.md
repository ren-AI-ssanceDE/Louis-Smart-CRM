# Louis Smart CRM

> **Version 2.0.0** — Das KI-gestützte CRM für kleine und mittelständische Unternehmen.
> Ein integrierter AI-Assistent („Louis AI") erledigt CRM-Aufgaben im Chat: Kontakte, Firmen, Angebote, Rechnungen (ZUGFeRD/XRechnung), Notizen, Wissensdatenbank, Workflows und MCP-Anbindung.

---

## 🚀 Schnellstart — ein Befehl, alles läuft

**Voraussetzung:** [Docker](https://www.docker.com/) (mit Docker Compose v2) auf Windows, macOS oder Linux.

```bash
git clone <repo-url> louis-crm
cd louis-crm
docker compose up --build -d
```

Damit startet der **komplette Stack** automatisch: PostgreSQL-Datenbank (inkl. pgvector), App auf **http://localhost:3000**, Telegram-Gate, Whisper (Sprachsteuerung) und Ollama (lokale KI). Beim ersten Start migriert sich die Datenbank selbst und legt den Admin-Zugang an:

- **Login:** `admin@louis-crm.de` / `admin` (beim ersten Login ändern!)

**Für die KI-Funktionen (1 Minute extra):** Admin → KI-Einstellungen (Louis AI) → Provider wählen (OpenAI/DeepSeek/Anthropic/Gemini — oder lokales Ollama) → API-Key hinterlegen. Danach ist der Assistent voll einsatzfähig: Chat, Workflows, Rechnungen, Wissensdatenbank.

**Telegram (optional):** Admin → Telegram → Bot-Token vom [@BotFather](https://t.me/BotFather) eintragen — der Gate-Container übernimmt die Konfiguration automatisch (kein Neustart nötig).

> ✅ **Keine Datei-Editierung nötig:** Sämtliche Einstellungen (KI-Provider & -Key, Telegram, MCP-Server, Limits, Workflows, Governance) werden **ausschließlich über das Admin-Panel** konfiguriert und in der Datenbank gespeichert. Eine `.env`-Datei ist für den Betrieb nicht erforderlich — sie dient nur fortgeschrittenen Selbst-Hostern für Infrastruktur-Optimierung (z. B. eigenes Auth-Secret, DB-Zugang; Vorlage: `.env.example`).

> 💡 **GPU-Beschleunigung (optional):** Für lokale LLM-Subtasks (Ollama) auf Rechnern mit NVIDIA-GPU den `deploy`-Block im `docker-compose.yml` beim Service `ollama` aktivieren:
> ```yaml
>     deploy:
>       resources:
>         reservations:
>           devices:
>             - driver: nvidia
>               count: all
>               capabilities: [gpu]
> ```
> Ohne GPU läuft Ollama auf CPU — die KI-Hauptfunktionen nutzen den Cloud-Provider und sind davon unabhängig.

**📚 Ausführliche Dokumentation:** Für Anwender und Entwickler liegt die komplette Doku im Ordner [`docs/`](docs/) (Module, Installation, MCP, E-Rechnung, Sicherheit u. v. m.).

---

## 🧑‍💼 Teil 1 — Anwender

### Was ist Louis Smart CRM?

Louis Smart CRM ist ein webbasiertes CRM mit eingebautem KI-Assistenten. Du arbeitest über einen **Chat** (wie bei einem Messaging-Dienst): Louis versteht deine Anfrage in natürlicher Sprache und führt Aufgaben direkt im CRM aus — vom Anlegen eines Kontakts bis zum Versand eines Angebots.

### Die wichtigsten Bereiche

| Bereich | Was du damit machst |
|---|---|
| **Chat mit Louis** | Aufgaben in natürlicher Sprache: „Lege einen Kontakt für Firma X an", „Erstelle ein Angebot über 1.000 €", „Was haben wir letzte Woche besprochen?" |
| **Firmen & Kontakte** | Adressbuch mit Dokumenten-Ablage (Vault) pro Firma/Kontakt, Opt-in-Verwaltung |
| **Angebote & Rechnungen** | Angebote erstellen und versenden, Rechnungen mit **ZUGFeRD/XRechnung** (e-Rechnung) als PDF/A-3 |
| **Wissensdatenbank** | Dokumente hochladen — Louis durchsucht sie bei Fragen (RAG) |
| **Workflows** | Automatisierungen: „Wenn eine Rechnung fällig wird, schreibe eine Mahnung" — visueller DAG-Editor |
| **Admin-Bereich** | Einstellungen, MCP-Server, API-Schlüssel, Agent-Jobs, Governance-Regeln, Audit-Log |

### Start & Login

1. Stack starten: `docker compose up -d` (siehe Teil 2)
2. Browser öffnen: **http://localhost:3000**
3. Login: `admin@louis-crm.de` / `admin` (beim ersten Login ändern!)

### KI-Assistent — so arbeitest du mit Louis

- **Direkt ansprechen:** Louis führt Schreib-Aktionen zunächst als **Entwurf** aus und fragt bei Änderungen nach (Freigabe). Bestätigst du, wird geschrieben.
- **Kontext:** Louis merkt sich Präferenzen und Gespräche (Memory) und erinnert sich an frühere Sitzungen.
- **Dokumente anhängen:** PDF, DOCX, XLSX, CSV, TXT u. v. m. im Chat hochladen (max. 5, je 25 MB) — optional in die Wissensdatenbank indizieren.
- **Grenzen:** Louis nutzt einen konfigurierten LLM-Provider. Schreibende Aktionen erzeugen zuerst Entwürfe; Workflows und MCP-Zugriffe folgen den Governance-Regeln.

### Sicherheit & Datenschutz

- Passwörter werden mit **bcrypt** (per-User-Salt) gespeichert; alte Hashes werden beim nächsten Login automatisch migriert.
- **MCP-API-Schlüssel** sind widerrufbar und protokolliert; jeder Schreibzugriff landet im **Audit-Log** (filterbar, exportierbar).
- Mandanten sind isoliert (Tenant-Prinzip); die Liste der bekannten Restlücken findest du in der Entwickler-Doku.

---

## 🔧 Teil 2 — Entwickler

### Stack & Architektur

| Komponente | Technologie | Container |
|---|---|---|
| Frontend + API | TypeScript, React (Vite), tRPC, Express | `louis-crm-app` (:3000) |
| Datenbank | PostgreSQL 15 + pgvector (RAG-Embeddings) | `louis-crm-db` (:5432, db `louis_crm`) |
| LLM-Anbindung | Provider-agnostisch (OpenAI/DeepSeek, Anthropic, Gemini, Ollama) | — |
| E-Rechnung | ZUGFeRD/XRechnung, Mustang-Validator, Ghostscript (PDF/A-3) | in `louis-crm-app` |
| MCP | MCP-Server-Engine (Katalog + Presets + externe Server) | `louis-crm-app` |
| Wissensanbindung | Obsidian-MCP (Local REST API Plugin) | extern/Obsidian |
| Zusatzdienste | Whisper (:8000), Telegram-Gate, Ollama | compose |

**Wichtige Projektregeln (Auszug):**
- **Kein ORM** — nur parametrisiertes SQL (`pg`)
- **zod als Single Source of Truth** — jeder tRPC-Endpunkt mit Input-/Output-Schema
- **Hybrid-Store-Pflicht** — DB-Pfad + Fallback-Store (JSON) für Tests/Preview
- **i18n-Pflicht** — alle UI-Texte über `t()` mit `de.json` + `en.json`
- **🚫 Heilige Dateien** — `src/lib/zugferd.ts` und `docker-entrypoint.sh` dürfen **nicht** verändert werden (mechanischer Guard im pre-commit-Hook, Regel 0)

### Lokale Entwicklung

```bash
npm install                # Deps (postinstall: setup-assets lädt Fonts/Mustang)
docker compose up -d       # Vollständiger Stack (DB + App + Zusatzdienste)
npm run dev                # Dev-Server mit Hot-Reload (oder Container nutzen)
```

- Ohne DB-Env-Vars läuft die App im **Fallback-Modus** (`.local_fallback_db.json`, gitignored) — ideal für hermetische Tests.
- Nach `npm install`: `npm approve-scripts esbuild @esbuild/win32-x64 protobufjs` (npm blockt Postinstall).

### Qualitätssicherung

Das Projekt wird im Entwicklungsprozess mit **Unit-, Integrations- und End-to-End-Tests** abgesichert (Vitest + Playwright, inkl. MCP-Volltest und ZUGFeRD-/EN16931-Validierung). Die Test-Suiten und QA-Skripte sind Teil des internen Entwicklungsprozesses und liegen **nicht** im öffentlichen Repository.

Qualitäts-Gates vor jedem Release: TypeScript-Lint (`tsc --noEmit`), Projektregeln (u. a. keine hardcodierten UI-Texte — i18n DE/EN), Produktions-Build, komplette Test-Suite, Live-Verifikation gegen den Docker-Stack.

Deploy-Praxis: nach Änderungen `docker compose up -d --build app`, dann Verifikation gegen den Live-Stack. **Vor DB-Migrationen/Rebuilds: Backup** (`pg_dump` in ein separates Backup-Verzeichnis, nie ins Repo).

### Betrieb & Troubleshooting

- **Health:** `curl localhost:3000/api/health` → `{"status":"ok"}`
- **Logs:** `docker logs louis-crm-app`
- **Bekannter Build-Fix:** Lato-Fonts werden aus dem Build-Kontext kopiert (kein GitHub-Download); Mustang-CLI wird beim Build geladen (Netz nötig)

### Release & Versionierung

- Version in `package.json` (aktuell **2.0.0**); Änderungshistorie: `CHANGELOG.md`
- Bekannte akzeptierte Restrisiken: siehe `CHANGELOG.md` (Abschnitt „Bekannte Restrisiken“)
- Rollback: Docker-Image `louis-smart-crm-app:latest` neu bauen aus git-Tag; DB-Backup einspielen (siehe oben)
