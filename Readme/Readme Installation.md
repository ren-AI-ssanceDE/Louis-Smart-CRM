# 💻 Wiki: Installation, Systemstart & Deployment

Dieses Dokument beschreibt die Voraussetzungen, die Einrichtung der Entwicklungsumgebung sowie den Build-Prozess für den produktiven Betrieb von **Louis Smart CRM**.

---

## 📋 1. Systemvoraussetzungen

Bevor Sie das Projekt starten, stellen Sie sicher, dass folgende Softwarekomponenten auf Ihrem System oder Server installiert sind:

* **Node.js**: Version `18.x` oder höher (empfohlen `v20.x LTS`).
* **Java Runtime Environment (JRE)**: JRE 17 oder höher (und globaler `java` CLI-Pfad). Wird exklusiv von **Mustangproject** zur validen PDF/A-3b XML-Verschmelzung auf Server-Ebene benötigt.
* **Datenbank**: 
  * *Option A (Produktion)*: Eine laufende Instanz von **PostgreSQL** (v14+ empfohlen) mit installierter Erweiterung `pgvector` für semantische Vektorsuchen.
  * *Option B (Lokale Entwicklung)*: **Keine Datenbank erforderlich!** Louis Smart CRM verfügt über ein duales Dateisystem und weicht bei fehlender DB automatisch auf die lokale `.local_fallback_db.json` aus.

---

## ⚙️ 2. Umgebungsvariablen (`.env`)

Kopieren Sie die Beispieldatei `.env.example` in Ihr Project-Root-Verzeichnis und benennen Sie diese in `.env` um.

```env
# .env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="MY_APP_URL"

# Datenbank-Verbindungszeichenfolge (für Option A)
DATABASE_URL=postgres://user:password@localhost:5432/dbname
PGHOST=localhost
PGPORT=5432
PGUSER=user
PGPASSWORD=password
PGDATABASE=dbname

# Auth-Verschlüsselung & URL
AUTH_SECRET=your_auth_secret_here
AUTH_URL=http://localhost:3000
```

> **Wichtig:** Verwenden Sie für Client-Bibliotheken im Frontend das Präfix `VITE_` (z.B. `VITE_PUBLIC_API_URL`). Sicherheitsrelevante Passwörter wie `GEMINI_API_KEY` oder `DATABASE_URL` dürfen **niemals** mit `VITE_` deklariert werden, da sie sonst in den kompilierte Javascript-Code des Browsers eingebettet würden.

---

## 🚀 3. Starten des Entwicklungsservers

Um das Projekt lokal in der Entwicklungsumgebung zu booten:

1. **Abhängigkeiten installieren**:
   ```bash
   npm install
   ```
2. **Entwicklungsumgebung starten**:
   ```bash
   npm run dev
   ```
   Der Entwicklungsserver startet standardmäßig auf Port **3000** (Konfiguration über `server.ts` und Vite Proxy). Im Terminal sehen Sie, ob das System im PostgreSQL- oder im lokalen JSON-Fallback-Modus läuft.

---

## 🏗️ 4. Produktions-Build und Start

In einer Live-Umgebung (z.B. Docker-Container oder Cloud Run) wird das Frontend für maximale Ladegeschwindigkeiten über Vite vorkompiliert und der Express-Server läuft direkt und performant mit nativer TypeScript-Ausführung über `tsx`.

Die Build- und Start-Scripte in `package.json` sind dafür exakt vorkonfiguriert:

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "start": "cross-env NODE_ENV=production tsx server.ts",
    "build": "vite build"
  }
}
```

### Build- und Start-Ablauf:
1. **Bauen des Frontends**:
   ```bash
   npm run build
   ```
   Dieses Kommando erzeugt einen statischen Client-Ordner unter `/dist`.
2. **Produktions-Start des Fullstack-Servers**:
   ```bash
   npm run start
   ```
   Dieser Schritt startet den integrierten Express- und tRPC-Server im Produktionsmodus auf Port 3000 unter Nutzung von optimiertem Caching und statischer Asset-Zustellung.

---

## 🐳 5. Betrieb im Docker-Container

Die mitgelieferte `Dockerfile.txt` beziehungsweise `Dockerfile` kombiniert das Node-System und die Java-Laufzeitumgebung in ein einziges, schlankes Container-Image.

### Docker-Compose Starten:
```bash
docker-compose up --build -d
```
Dies startet sowohl die PostgreSQL-Datenbank (inklusive pgvector) als auch das CRM-System, komplett vorkonfiguriert und bereit für die erste Anmeldung.
