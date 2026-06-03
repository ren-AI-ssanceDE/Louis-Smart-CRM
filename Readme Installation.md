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
# .env.example
PORT=3000
NODE_ENV=development

# Gemini API-Schlüssel für Louis AI
GEMINI_API_KEY=dein_gemini_api_key_hier

# Datenbank-Verbindungszeichenfolge (für Option A)
DATABASE_URL=postgresql://postgres:password@localhost:5432/louis_crm

# Verschlüsselungs-Schlüssel für Session-Cookies (Auth)
SESSION_SECRET=ein_sehr_sicherer_zufaelliger_string
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

In einer Live-Umgebung (z.B. Docker-Container oder Cloud Run) wird das Frontend für maximale Ladegeschwindigkeiten vorkompiliert und der TypeScript Express-Server in ein optimiertes CommonJS-Bündel übersetzt.

Die Build-Scripte in `package.json` sind dafür exakt vorkonfiguriert:

```json
{
  "scripts": {
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs"
  }
}
```

### Build- und Start-Ablauf:
1. **Bauen des Projekts**:
   ```bash
   npm run build
   ```
   Dieses Kommando erzeugt einen statischen Client-Ordner unter `/dist` und kompiliert den Server zu der komprimierten Datei `dist/server.cjs`.
2. **Produktions-Start**:
   ```bash
   npm run start
   ```
   Dieser Schritt startet den HTTP-Server auf Port 3000 directly über Node, ohne TS-Kompilierungsschritte zur Laufzeit, was Ausführungszeiten minimiert.

---

## 🐳 5. Betrieb im Docker-Container

Die mitgelieferte `Dockerfile.txt` beziehungsweise `Dockerfile` kombiniert das Node-System und die Java-Laufzeitumgebung in ein einziges, schlankes Container-Image.

### Docker-Compose Starten:
```bash
docker-compose up --build -d
```
Dies startet sowohl die PostgreSQL-Datenbank (inklusive pgvector) als auch das CRM-System, komplett vorkonfiguriert und bereit für die erste Anmeldung.
