# ✈️ Wiki: Telegram Bot Gateway (Conversational Co-Pilot)

Das **Telegram Bot Gateway** ermöglicht Ihnen den direkten, abhörsicheren Zugriff auf **Louis Smart CRM** von Ihrem Smartphone aus. Anstatt sich in einer mobilen Weboberfläche anzumelden, können Sie sich ganz natürlich im Alltagsdeutsch mit Ihrem Louis AI Co-Pilot per Telegram unterhalten – so als würden Sie mit einem Kollegen chatten.

Dieser Dienst läuft vollkommen lokal auf Ihrer CRM-Instanz. Es werden keine Daten an externe Drittanbieter-Cloud-Dienste (außer direkt an die verschlüsselte, offizielle Telegram API) übertragen.

---

## 🛠️ 1. Schritt-für-Schritt Einrichtung

Die Einrichtung eines eigenen Telegram-Bots ist in weniger als 3 Minuten erledigt. Folgen Sie einfach diesen vier Schritten:

### Schritt 1: Bot bei Telegram erstellen
1. Öffnen Sie die Telegram-App auf Ihrem Smartphone oder Computer.
2. Suchen Sie nach dem offiziellen Bot-Verzeichnisdienst **`@BotFather`** (achten Sie auf das blaue Verifizierungshäkchen).
3. Starten Sie den Chat und senden Sie den Befehl `/newbot`.
4. Folgen Sie den Anweisungen: Vergeben Sie zuerst einen **Anzeigenamen** (z. B. `Mein Louis CRM`) und anschließend einen eindeutigen **Benutzernamen**, welcher zwingend auf `bot` enden muss (z. B. `LouisSmartCrm_bot`).
5. **WICHTIG:** Nach erfolgreicher Erstellung erhalten Sie ein langes Passwort, das sogenannte **HTTP API Token** (z. B. `123456789:ABCdefGh...`). Kopieren Sie dieses in Ihre Zwischenablage.

### Schritt 2: Eigene Telegram-ID ermitteln
Um zu verhindern, dass Fremde auf Ihr CRM zugreifen können, sperrt das System standardmäßig alle Chats, bis Ihre persönliche Telegram-ID explizit freigeschaltet wird.
1. Suchen Sie bei Telegram nach dem Dienst **`@userinfobot`** und starten Sie den Chat.
2. Der Bot antwortet Ihnen sofort mit Ihrer numerischen **ID** (z. B. `987654321`). Kopieren Sie diese ID ebenfalls.

### Schritt 3: Registrierung im Louis Smart CRM
1. Melden Sie sich im CRM als Administrator an und navigieren Sie zum **Admin-Bereich**.
2. Wechseln Sie in den Reiter **"Telegram Einstellungen"**.
3. Setzen Sie den Gateway-Status auf **Aktiv**.
4. Fügen Sie Ihr in Schritt 1 kopiertes **Telegram Bot Token** in das entsprechende Feld ein.
5. Tragen Sie Ihre in Schritt 2 ermittelte **Benutzer-ID** in das Feld „Zugelassene Telegram-IDs“ ein.
   * *Tipp:* Wenn mehrere Mitarbeiter auf denselben CRM-Knoten zugreifen dürfen, trennen Sie die IDs einfach mit einem Komma (z. B. `987654321, 112233445`).

### Schritt 4: Verbindung testen und speichern
1. Klicken Sie auf die Schaltfläche **„Verbindung Testen“**. 
2. Das CRM sendet nun eine direkte verschlüsselte Testnachricht via Telegram an Ihr Smartphone.
3. Sobald Sie die Nachricht erhalten, klicken Sie auf **„Speichern“**. Das Gateway ist nun vollautomatisch im Hintergrund aktiv!

---

## 💬 2. Interaktion & Conversational UI

Nach der Einrichtung können Sie Ihren Bot anschreiben. Senden Sie einfach die Nachricht `/start` oder `hilfe`, um eine klickbare Übersicht zu erhalten. 

Dank des integrierten **ReAct-Agentenloops** müssen Sie keine kryptischen Befehle lernen. Sprechen Sie mit Louis in normaler Sprache:

### Praktische Anwendungsbeispiele:

* 🔍 **Suchen & Finden:**
  - „Gibt es Kontakte in der Stadt Berlin?“
  - „Zeige mir Informationen zum Unternehmen Acme Corp.“
* 🏢 **Firmen & Ansprechpartner verwalten (im Entwurfsmodus):**
  - „Erstelle bitte ein neues Unternehmen namens Ren-AI-ssance GmbH in München mit der IBAN DE12...“
  - „Lege einen neuen Kontakt für Julia Sommer an mit der E-Mail julia@sommer.de“
* 🧾 **Umsatz & Rechnungsanalysen:**
  - „Wer steht aktuell noch im Zahlungsverzug? Zeige mir alle offenen Rechnungen.“
  - „Wieviel Netto-Umsatz haben wir im letzten Monat erzielt?“
  - „Schreibe einen Rechnungsentwurf für die Acme AG für 5 Stunden Softwareberatung.“

---

## 🛡️ 3. Sicherheitskonzept & DSGVO-Konformität

Da Geschäftsdaten und Belege absolut vertraulich sind, greifen beim Telegram-Gateway strengste Schutzmechanismen:

### Zero-Trust Zugriffskontrolle (Security-Sperre)
Nachrichten von Telegram-Konten, deren Steuerungsschlüssel oder numerische Chat-ID nicht exakt im Administrationspanel hinterlegt sind, werden **sofort blockiert**. Der unerlaubte Nutzer erhält lediglich eine Fehlermeldung (`Zugriff verweigert`). Es fließen keinerlei CRM-Informationen ab.

### Local-Only Transport
Die gesamte Übertragung läuft direkt zwischen Ihrem lokalen Host/Docker-Container und der offiziellen, SSL-verschlüsselten Telegram API-Schnittstelle. Es gibt keine Zwischenstationen, Proxy-Server oder Cloud-Verteiler der Entwickler.

### Transparente Auditierung
Jeder über Telegram initiierte Dateneingriff, jede Abfrage und jede Entwurfserstellung von Louis AI im Auftrag des Chatpartners wird lückenlos mit dem Namen des jeweiligen Nutzers im revisionssicheren **Audit-Log** der CRM-Instanz aufgezeichnet.
