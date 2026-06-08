<img width="2064" height="1110" alt="louis_smart_crm_release" src="https://github.com/user-attachments/assets/8033d26b-97c3-4587-868e-033392c28694" />

# 🤖 Louis Smart CRM

[![Tech Stack: TypeScript](https://img.shields.io/badge/Stack-TypeScript%20%2F%20React%20%2F%20Express-blue?style=flat-square)](https://www.typescriptlang.org/)
[![API Protocol: tRPC](https://img.shields.io/badge/API-tRPC%20%2B%20Zod-9b4dca?style=flat-square)](https://trpc.io/)
[![Compliance: EN 16931 & GoBD](https://img.shields.io/badge/Compliance-EN%2016931%20%7C%20GoBD%20%7C%20DSGVO-emerald?style=flat-square)](https://eur-lex.europa.eu/ELI/reg/2016/679/oj)
[![License: Open Source](https://img.shields.io/badge/License-MIT%2FApache-orange?style=flat-square)](#)

Louis Smart CRM ist eine hochperformante, typsichere und KI-zentrierte Fullstack-Anwendung zur Verwaltung von B2B- und B2G-Unternehmensbeziehungen. Anstelle starrer Formulare kombiniert das System einen autonomen KI-Copiloten mit einer vollständig zertifizierten, rechtssicheren E-Rechnungs-Engine nach europäischem Standard.

---

## 🚀 Key Features

* ** MCP - Model Context Protocol**: Steuer dein CRM und dein LLM von überall - ob local via Codex oder von unterwegs mit Telegram - die Möglichkeiten sind unbegrenzt!.
* ** Telegram**: Nativer Telegram Support über mitgelieferten lokalen Telegram Botserver - keine komplexe Smartphone App, sonern native Einbindung in deine Nachrichten App.
* ** Workflows**: Lass das CRM arbeiten und konzentriere dich auf wichtigere Aufgaben. Ob automatischer Mahnlauf, Marketing E-Mails oder komplexe Auswertungen. Mit den Workflows automatisierst du das alles einfach. Sag dem CRM im Chat einfach welche Automatisierung du benötigt oder erstelle manuelle Abläufe, deine Wahl.
* ** Louis AI Copilot (Human-in-the-Loop)**: Ein hochentwickelter ReAct-Entscheidungsloop verarbeitet CRM-Anweisungen in natürlicher Sprache. Aus Sicherheitsgründen agiert die KI rein entwurfsbasiert über ein `proposedChanges`-Panel – keine E-Mail und keine Buchung verlässt das System ohne menschliche Freigabe.
* ** GoBD- & EN 16931-konforme E-Rechnung**: Vollautomatische Generierung von gesetzeskonformen ZUGFeRD (2.2+) / Factur-X 1.0 Hybriddateien und XRechnung 3.0 für Behörden inklusive Leitweg-ID-Validierung. 
* ** Dualer Speicher-Layer (Maximale Resilienz)**: Unterstützt im Produktivbetrieb PostgreSQL mit `pgvector` für semantische KI-Vektorsuchen. Bei fehlender Datenbankverbindung weicht das System nahtlos auf ein lokales In-Memory Fallback-Dateisystem (`.local_fallback_db.json`) aus.
* ** DSGVO & Revisionssicherheit**: Integriert ein unveränderbares Append-Only Audit-Log für alle sensiblen Aktionen. Bietet DSGVO-Datenportabilität per 1-Klick-Export (Art. 20) sowie ein intelligentes, kaskadierendes Löschkonzept (Art. 17), das die 10-jährige GoBD-Aufbewahrungspflicht für Buchhaltungsdaten schützt.
---

## 🛑 WICHTIGER COMPLIANCE-HINWEIS (Read-Only)

> **Die Kernkomponenten der E-Rechnungs-Engine sind nach EN 16931 und PDF/A-3b vollständig zertifiziert.**
> Jede manuelle oder autonome Modifikation an den Dateien `src/lib/zugferd.ts`, `src/server/pdfHelper.ts`, `scripts/PDFA_def.ps` sowie der Docker-Java-Umgebung zerstört die rechtssichere Validität und führt zum Erlöschen des Konformitätssiegels nach GoBD. Diese Dateien sind im Repository als **streng lesegeschützt** zu betrachten.

---

## 🛠️ Tech Stack

### Frontend (Client)
* **Framework**: React 18 (Funktionale Komponenten & Hooks)
* **Build-System & Styling**: Vite & Tailwind CSS (Schriften: Inter & JetBrains Mono)
* **Animationen & Charts**: Framer Motion & Recharts / D3.js

### Backend (Server)
* **Laufzeit & API**: Node.js mit Express v4+ und tRPC für vollständige Typsicherheit via Zod-Verträge
* **KI-Orchestration**: `@google/genai` Node.js SDK (Gemini-Modelle) mit integriertem, deterministischem QA-Critic-Layer
* **Hybrid-Verschmelzung**: `pdf-lib` kombiniert mit der **Mustangproject CLI** (vorausgesetzt wird Java JRE 17+)
* **Mailing**: Nodemailer mit sicherer TLS/SMTP-Verbindung

---

## ⚙️ Installation & Schnellstart

### Systemvoraussetzungen
* **Node.js**: Version `18.x` oder höher (empfohlen `v20.x LTS`)
* **Java Runtime Environment (JRE)**: JRE 17 oder höher (globaler `java`-CLI-Pfad für Mustangproject)
* **Datenbank**: PostgreSQL v14+ (mit Erweiterung `pgvector`) **oder** direkt starten via integriertem Local-JSON-Fallback.

### Lokale Einrichtung

Die EASY Version:
1. Lade dir Docker Desktop herunter.
2. Öffne Docker Desktop
3. Öfnne "Gordon" den Docker KI Assistenten
4. Gib folgenden Prompt in das Chatfenster von Gordon ein: "Sieh dir das folgende Projekt an. Alle Dateien sind vorhanden. Erstelle ein sauberes Image und starte die Container. (füge den Link zum lokalen Download-Pfad des Projekts ein. z.B. C:/Dokumente/louis-smart-crm)
5. Docker übernimmt den Rest. Warte bis die Container gestartet sind. Navigiere dann im Browser zu http://localhost:3000/

### Reguläre Installation

1. **Repository klonen und Abhängigkeiten installieren**:
   ```bash
   npm install


2. **Umgebungsvariablen konfigurieren**:
Erstelle eine `.env`-Datei im Root-Verzeichnis (basierend auf `.env.example`):
```env
PORT=3000
NODE_ENV=development
GEMINI_API_KEY=dein_gemini_api_key_hier
DATABASE_URL=postgresql://postgres:password@localhost:5432/louis_crm
SESSION_SECRET=ein_sehr_sicherer_zufaelliger_string

```


*Hinweis: Clientseitige Variablen benötigen das Präfix `VITE_`. Sicherheitskritische Schlüssel wie `GEMINI_API_KEY` verbleiben ohne Präfix geschützt auf dem Server.*
3. **Entwicklungsserver starten**:
```bash
npm run dev

```


Das System startet standardmäßig auf Port **3000**. Das Terminal zeigt an, ob der PostgreSQL- oder der JSON-Fallback-Modus aktiv ist.

### 🐳 Start mit Docker-Compose

Für eine vollständig vorkonfigurierte Umgebung inklusive PostgreSQL und `pgvector`:

```bash
docker-compose up --build -d

```

---

## 🧪 Validierung & Qualitätssicherung

Das System verfügt über eine integrierte End-to-End-Validierungsprüfung zur Einhaltung aller E-Rechnungsstandards:

```bash
# Simuliert und prüft Single-Line, Multi-Line, Mixed-VAT und B2G-XRechnungen
npx ts-node scripts/e2e-validate.ts

```

Die Testergebnisse werden strukturiert unter `/e2e-out/summary.json` abgelegt.

```

```
