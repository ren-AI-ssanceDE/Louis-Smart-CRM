# ✈️ Telegram Bot Gateway (Conversational Co-Pilot)

> Mit dem Telegram-Bot steuern Sie **Louis Smart CRM vom Smartphone** — einfach per Chat, als würden Sie einem Kollegen schreiben. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist das?

Ein **persönlicher Chatbot in Ihrer Telegram-App**, der mit Ihrem CRM verbunden ist. Sie schreiben Louis eine Nachricht — und er sucht, erstellt oder analysiert für Sie, immer mit Ihrer Freigabe. Alles läuft über Ihre eigene Installation; Ihre Daten bleiben bei Ihnen.

## Beispiele aus dem Alltag

* 🔍 **Suchen:** *„Gibt es Kontakte in der Stadt Berlin?“* · *„Zeige mir Informationen zur Firma Acme Corp.“*
* 🏢 **Anlegen (als Entwurf):** *„Erstelle ein neues Unternehmen namens Ren-AI-ssance GmbH in München mit IBAN DE12…“* · *„Lege einen Kontakt für Julia Sommer an (julia@sommer.de).“*
* 🧾 **Rechnungen & Umsatz:** *„Wer steht aktuell im Zahlungsverzug?“* · *„Wie viel Netto-Umsatz hatten wir im letzten Monat?“* · *„Schreibe einen Rechnungsentwurf für die Acme AG über 5 Stunden Beratung.“*
* 🎤 **Sprachnachrichten:** Sie können Louis auch **Sprachnachrichten** schicken — er versteht sie (Spracherkennung) und arbeitet sie ab.
* ✅ **Freigaben:** Vorschläge von Louis erscheinen als Karten — **annehmen oder ablehnen direkt im Chat**.

## Einrichtung in 4 Schritten (ca. 3 Minuten)

1. **Bot erstellen:** In Telegram zu **@BotFather** → `/newbot` → Namen vergeben (muss auf `bot` enden, z. B. `LouisSmartCrm_bot`) → **Token kopieren** (langes Passwort).
2. **Ihre ID finden:** In Telegram zu **@userinfobot** → Ihre numerische ID wird angezeigt → kopieren.
3. **Im CRM eintragen:** Admin → **„Telegram Einstellungen“** → Status **Aktiv** → Bot-Token einfügen → Ihre ID unter „Zugelassene Telegram-IDs“ eintragen (mehrere IDs mit Komma trennen).
4. **Testen:** **„Verbindung Testen“** → Sie erhalten eine Testnachricht → **Speichern**.

## Sicherheit — wichtig zu wissen

* **Nur Sie können zugreifen:** Nicht freigeschaltete Telegram-Konten werden sofort blockiert („Zugriff verweigert“). Das System ist standardmäßig verschlossen.
* **Alles wird protokolliert:** Jede Aktion über Telegram landet im Sicherheitsprotokoll (Audit-Log).
* **Keine Eigenmächtigkeit:** Louis erstellt nur **Entwürfe** — die finale Freigabe liegt immer bei Ihnen.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Schritt-für-Schritt Einrichtung (technisch)

### Schritt 1: Bot bei Telegram erstellen
1. Suchen Sie in Telegram nach **`@BotFather`** (blaues Verifizierungshäkchen).
2. Senden Sie `/newbot`, vergeben Sie einen **Anzeigenamen** und einen **Benutzernamen** (muss auf `bot` enden, z. B. `LouisSmartCrm_bot`).
3. **WICHTIG:** Kopieren Sie das ausgegebene **HTTP API Token** (z. B. `123456789:ABCdefGh...`).

### Schritt 2: Eigene Telegram-ID ermitteln
1. Suchen Sie nach **`@userinfobot`** und starten Sie den Chat.
2. Der Bot antwortet mit Ihrer numerischen **ID** (z. B. `987654321`).

### Schritt 3: Registrierung im CRM (Admin → „Telegram Einstellungen“)
1. Gateway-Status auf **Aktiv** setzen.
2. **Telegram Bot Token** einfügen.
3. **Zugelassene Telegram-IDs** eintragen — mehrere IDs mit Komma trennen (z. B. `987654321, 112233445`).

### Schritt 4: Verbindung testen und speichern
1. **„Verbindung Testen“** klicken → CRM sendet eine verschlüsselte Testnachricht an Ihr Smartphone.
2. Nach Empfang **„Speichern“** klicken — das Gateway ist aktiv.

## 2. Interaktion & Conversational UI

Senden Sie `/start` oder `hilfe` für eine klickbare Übersicht. Dank des ReAct-Agentenloops sind keine kryptischen Befehle nötig:

* 🔍 **Suchen & Finden**: „Gibt es Kontakte in der Stadt Berlin?“, „Zeige mir Informationen zum Unternehmen Acme Corp.“
* 🏢 **Firmen & Kontakte (Entwurfsmodus)**: „Erstelle ein neues Unternehmen namens Ren-AI-ssance GmbH in München mit der IBAN DE12…“, „Lege einen Kontakt für Julia Sommer an (julia@sommer.de)“
* 🧾 **Umsatz & Rechnungen**: „Wer steht aktuell im Zahlungsverzug?“, „Wieviel Netto-Umsatz hatten wir im letzten Monat?“, „Schreibe einen Rechnungsentwurf für die Acme AG für 5 Stunden Softwareberatung“
* 🎤 **Sprachnachrichten**: Audionachrichten (.ogg/Opus) werden über das Whisper-STT transkribiert und verarbeitet
* ✅ **Freigaben**: Vorgeschlagene Änderungen erscheinen als Freigabe-Karten — bestätigen oder ablehnen direkt im Chat

## 3. Technik: Das Gateway als MCP-Client

Das Gateway ist der Referenz-Client des integrierten MCP-Servers:

1. **SSE-Verbindung**: Beim Start verbindet es sich mit `http://app:3000/api/mcp/sse`.
2. **Dynamic Tool Mapping**: Es fragt über `tools/list` die verfügbaren CRM-Tools ab.
3. **Routing**: Einfache Fragen → direkt an `search_contacts` etc.; komplexe Anweisungen → `chat_with_louis` (ReAct-Loop im Backend).
4. **Ergebnis-Aufbereitung**: Antworten werden für die Telegram-Oberfläche formatiert.

## 4. Sicherheitskonzept & DSGVO

### Zero-Trust Zugriffskontrolle
Nachrichten von Telegram-Konten, deren ID nicht exakt in der Allowlist hinterlegt ist, werden **sofort blockiert** — der Absender erhält nur „Zugriff verweigert“, es fließen keinerlei CRM-Daten ab.

### Local-Only Transport
Die Übertragung läuft direkt zwischen Ihrem Host/Docker-Container und der offiziellen Telegram-API. Keine Zwischenstationen, keine Cloud-Verteiler der Entwickler.

### Transparente Auditierung
Jeder über Telegram initiierte Zugriff, jede Abfrage und jeder Entwurf wird lückenlos im **Audit-Log** der CRM-Instanz aufgezeichnet.

### Human-in-the-Loop
Über Telegram erzeugte Entitäten bleiben **Entwürfe** — die finale Freigabe liegt immer beim angemeldeten Benutzer (im Chat oder im CRM-Freigabe-Center).
