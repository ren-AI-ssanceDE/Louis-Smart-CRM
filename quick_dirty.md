# ⚡ Quick & Dirty Guide: Docker-Installation & Telegram-Einrichtung

Dieses Handbuch beschreibt die minimale Schritt-für-Schritt-Anleitung, um **Louis Smart CRM** inklusive der PostgreSQL-Vektordatenbank (pgvector) und dem dezentralen Telegram-Bot-Gateway via Docker und Docker Compose in Rekordzeit in Betrieb zu nehmen.

⏰ **Stand**: Juni 2026. Alle System-Komponenten laufen lokal, DSGVO-konform und ohne unautorisierte Cloud-Abhängigkeiten.

---

## 📋 Überblick über das Gesamtsystem

Wenn Sie fertig sind, läuft folgendes Setup über ein einziges, isoliertes Docker-Netzwerk:
1. **`db` (Postgres + pgvector)**: Der relationale Datenspeicher für Kunden, Kontakte, Rechnungen und KI-Vektoren.
2. **`app` (Express + React, Port 3000)**: Das CRM-Hauptsystem, das gleichzeitig als tRPC-Server und MCP-Server (Model Context Protocol via Server-Sent Events/SSE) fungiert.
3. **`telegram-bot-gate`**: Ein dezentraler Daemon, der neue Nachrichten von Ihrem Telegram-Bot abfragt und als MCP-Client direkt mit dem Express-Server kommuniziert.

---

## 🐳 Schritt 1: Docker und Docker Compose installieren

### 🐧 Für Linux (Debian / Ubuntu / Raspbian)
Kopieren Sie diesen Befehlsblock in Ihr Terminal, um Docker und das Compose-Plugin vollständig zu installieren:

```bash
# System aktualisieren
sudo apt-get update && sudo apt-get upgrade -y

# Notwendige Zertifikate laden
sudo apt-get install -y ca-certificates curl gnupg

# Offiziellen Docker GPG-Key hinzufügen
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Repository einrichten
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.p/docker.list > /dev/null

# Docker-Pakete installieren
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Prüfen, ob Docker läuft und ohne sudo ausführbar ist
sudo docker run hello-world
```

---

### 🪟 Für Windows & macOS
1. Laden Sie **Docker Desktop** herunter: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Starten Sie den Installer und folgen Sie den Bildschirmanweisungen.
3. *Windows-Tipp*: Stellen Sie sicher, dass das **WSL2-Backend** (Windows-Subsystem für Linux) in den Docker-Einstellungen aktiviert ist.
4. Öffnen Sie die PowerShell oder das Terminal und überprüfen Sie die Installation:
   ```bash
   docker --version
   docker compose version
   ```

---

## ✈️ Schritt 2: Telegram-Bot einrichten (@BotFather)

Um Ihr CRM verschlüsselt von unterwegs per Chat steuern zu können, müssen Sie einen eigenen (kostenlosen) Bot bei Telegram registrieren.

1. Öffnen Sie Telegram und suchen Sie nach dem offiziellen Account: **@BotFather** (erkennbar am blauen Verifizierungs-Haken).
2. Starten Sie den Chat und senden Sie den Befehl:
   ```text
   /newbot
   ```
3. Senden Sie einen **Namen** für Ihren Bot (z. B. `Louis Smart CRM`).
4. Senden Sie einen eindeutigen **Benutzernamen**, der zwingend auf `bot` enden muss (z. B. `louis_smart_crm_bot` oder `mein_persoenlicher_louis_bot`).
5. **Wichtig:** @BotFather sendet Ihnen nun eine Bestätigung mit dem **HTTP-API-Token** (z. B. `7123456789:AAF_ExampleTokenString...`). Kopieren Sie dieses Token sorgfältig.

### Eigene Telegram User-ID ermitteln
Um zu verhindern, dass Fremde auf Ihr CRM zugreifen können, sperrt das System standardmäßig alle Nachrichten aus, deren Absender-ID nicht explizit freigegeben ist.
1. Suchen Sie auf Telegram nach dem Bot **@userinfobot** oder **@MissRose_bot**.
2. Senden Sie eine beliebige Nachricht oder klicken Sie auf `/start`.
3. Der Bot antwortet mit Ihrer numerischen Benutzer-ID (z. B. `987654321`). Notieren Sie sich diese ID.

---

## 📝 Schritt 3: Infrastruktur-Umgebung (`.env`)

**Sie haben vollkommen recht:** Fast alle fachlichen Einstellungen (wie Ihr Telegram-Bot-Token, die erlaubten Benutzer-IDs, SMTP-Mail-Zertifikate, Web-Suche etc.) werden **bequem und direkt im Webinterface unter "Admin > Verbindungen"** konfiguriert und in der Datenbank gespeichert. Dafür müssen Sie **keine** Systemdateien bearbeiten.

Die `.env`-Datei dient **ausschließlich** grundlegenden Infrastruktur-Konfigurationen, die das System zum Starten der Server- und Datenbankverbindung benötigt. 

Nutzen Sie dafür einfach die bereits existierende Vorlage **`.env.example`**:

1. Kopieren Sie die `.env.example` und benennen Sie die Kopie in **`.env`** um:
   ```bash
   cp .env.example .env
   ```
2. Passen Sie in der `.env` nur die wichtigsten System-Variablen an:
   * **`DATABASE_URL`**: Ihre PostgreSQL-Verbindung (falls Sie vom Standard-Compose-Setup abweichen; standardmäßig im Docker Compose bereits vorkonfiguriert).
   * **`AUTH_SECRET` / `SESSION_SECRET`**: Ein beliebiger, sicherer Zufallsstring zur Verschlüsselung Ihrer Logins.
   * **`GEMINI_API_KEY`**: *(Optional)* Nur, wenn Sie server-seitige KI-Funktionen nutzen möchten (dieser Schlüssel darf aus Sicherheitsgründen nie im Browser landen).

Alle weiteren Einstellungen zur Integration Ihrer Kanäle nehmen Sie später direkt im laufenden System vor!

---

## 🚀 Schritt 4: System vollständig starten

Da das Projekt vollautomatisch auf das "Ein Befehl, alles läuft"-Prinzip ausgelegt ist, starten Sie den gesamten Verbund mit:

```bash
docker compose up --build -d
```
*(Hinweis: Auf älteren Systemen lautet der Befehl ggf. `docker-compose up --build -d`)*

Docker lädt nun das PostgreSQL-Image herunter, baut das Haupt-CRM (inklusive JRE 17 für rechtskonforme E-Rechnungen nach EN 16931) und initialisiert den Telegram-Daemon.

### Status und Logs überwachen:
Um zu prüfen, ob alle Systeme erfolgreich hochgefahren sind, nutzen Sie:

```bash
docker compose logs -f
```

Besonders wichtig sind folgende Zeilen in den Logs:
- `louis-crm-db | database system is ready to accept connections`
- `louis-crm-app | Server running on port 3000`
- `louis-telegram-bot-gate | === Louis Smart CRM Telegram Gateway starting ===`

---

## ⚙️ Schritt 5: Telegram im Admin-Panel aktivieren

Wenn der Telegram-Container zum ersten Mal startet, verbleibt er im inaktiven Wartezustand (IDLE), solange in der CRM-Datenbank keine Zugangsdaten hinterlegt sind. Sie müssen zu keinem Zeitpunkt Container manuell verändern, Umgebungsvariablen neu laden oder im Terminal arbeiten!

1. Öffnen Sie Ihren Browser und rufen Sie die Adresse auf: **`http://localhost:3000`** (bzw. die IP-Adresse Ihres Servers).
2. Loggen Sie sich mit den Benutzerdaten ein.
3. Navigieren Sie zu: **Admin > Verbindungen** (oder direkt über das Zahnrad-Menü).
4. Suchen Sie den Bereich **Telegram-Bot-Gateway**.
5. Füllen Sie die Felder aus:
   - **Bot-Token**: Fügen Sie das von `@BotFather` erhaltene HTTP-API-Token ein.
   - **Erlaubte Telegram-Benutzer-IDs**: Tragen Sie Ihre numerische Benutzer-ID ein. Falls Sie mehreren Personen Zugriff geben möchten, trennen Sie die IDs einfach mit einem Komma (z. B. `987654321, 112233445`).
6. Klicken Sie auf **Verbindung speichern**.
7. Testen Sie das Setup: Klicken Sie auf **Status testen** – Ihr Telegram-Bot sendet Ihnen direkt eine Testnachricht auf Ihr Smartphone!

Der `telegram-bot-gate`-Container erkennt die Einstellungsänderung binnen 15 Sekunden vollautomatisch und startet das Empfangs-Polling.

---

## 🎮 Schritt 6: CRM über Telegram steuern (MCP-Tools)

Öffnen Sie den Chat mit Ihrem erstellten Telegram-Bot auf dem Handy.

### 1. Verbindungstest
Senden Sie den Befehl `/status`. Der Bot antwortet sofort mit Live-Metriken:
* Verbindung zum Server-Backend (Aktiv)
* Daten-Modus (PostgreSQL oder lokaler JSON-Sandbox)
* Aktuelle Anzahl geladener Kontakte

### 2. Kontaktsuche
Senden Sie `/suche Müller` oder einfach nur den Namen eines Kontakts. Der Bot nutzt das integrierte CRM-MCP-Tool, durchsucht Ihre Datenbank und liefert Name, Anschrift, E-Mail, Telefonnummer sowie die eindeutige UUID zurück.

### 3. Registerübergreifende Analyse (CRM Analyst)
Wenn Sie Ihren `GEMINI_API_KEY` hinterlegt haben, können Sie dem Bot komplexe Fragen stellen:
```text
/analyst Welche Rechnungen sind aktuell noch offen und wie ist der Gesamtbetrag?
```
Oder:
```text
/analyst Finde alle Unternehmen, die ihren Hauptsitz in Hamburg oder Berlin haben.
```

### 4. Neue Firma anlegen (`/firma`)
Sie können Firmen entweder strukturiert mit Semikolons (Reihenfolge: Name; Straße; Hausnummer; PLZ; Ort; E-Mail; Telefon; UStID; Steuernummer; Ansprechpartner) oder flexibel per Key-Value-Paaren anlegen:

*Variante Key-Value (Empfohlen):*
```text
/firma name=Beispiel GmbH; strasse=Musterweg; plz=20095; ort=Hamburg; ust=DE987654321
```

### 5. Beleg/Rechnungsentwurf schreiben (`/rechnung`)
Das Erstellen von Rechnungsentwürfen ist direkt aus dem Chat möglich.

*Syntax:* `/rechnung firma=UUID_oder_Name; tage=Zahlungsziel | Postentext, Menge, Einzelpreis, [MwSt-Satz], [Einheit]*`

*Konkretes Beispiel:*
```text
/rechnung firma=Beispiel GmbH; tage=14 | Webdesign Consulting, 8, 110, 19, HUR | Server-Setup Pauschal, 1, 250, 19, C62
```
*Ergebnis:* Der Bot validiert den Mandanten, kalkuliert alle Netto-/Bruttowerte und meldet die erfolgreiche Erstellung des Rechnungsentwurfs inklusive neu generierter Rechnungsnummer an Sie zurück.

⚠️ **Sicherheits- & Compliance-Vorgabe:** Alle über den Telegram-Bot generierten Aktionen legen Belege ausschließlich als **Entwürfe (Drafts)** im CRM ab. Die finale Freigabe, PDF/A-3b-Konvertierung (ZUGFeRD) und der E-Mail-Export müssen aus steuerrechtlichen Gründen (GoBD / EN 16931) zwingend manuell im Webinterface durch den Administrator bestätigt werden.

---

## 🛠️ Trubbleshooting (Fehlerbehebung)

| Problem | Ursache | Lösung |
| :--- | :--- | :--- |
| **Bot antwortet nicht** | Falsches Token oder Container im Idle-Modus | Prüfen Sie in **Admin > Verbindungen**, ob der grüne Status aktiviert ist. Starten Sie ggf. eine Testnachricht. |
| **"Zugriff verweigert"** | Ihre Telegram-ID fehlt in der Whitelist | Senden Sie eine Nachricht an `@userinfobot`, um Ihre korrekte ID zu ermitteln, und tragen Sie diese im Admin-Panel unter den erlaubten IDs ein. |
| **E-Rechnungs PDF wird nicht generiert** | Fehlende Java Runtime im Container | Nutzen Sie ausschließlich das offizielle `Dockerfile` bzw. `Dockerfile.txt`, da dieses die benötigte, zertifizierte Headless-JRE 17 enthält. |
| **Vektorsuche meldet Fehler** | `pgvector` Erweiterung in Postgres fehlt | Der Compose-Verbund startet mit `ankane/pgvector:latest`, welches pgvector vorinstalliert hat. Verändern Sie das DB-Image nicht. |
