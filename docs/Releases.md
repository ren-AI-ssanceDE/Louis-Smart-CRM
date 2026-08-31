## 🚀 Release v2.1.12: Präzise Workflow-Automation & ehrliche Fehlermeldungen

Mit **2.1.12** werden gelernte Workflows noch präziser und automatisierte Anbindungen flexibler: Firma-Bedingungen wie „der zur Firma Muster GmbH gehört" treffen jetzt exakt die genannte Firma, und externe Systeme können Abläufe mit den Tool-Namen lernen, die ihnen die Schnittstelle selbst anbietet. Zudem meldet Louis fehlgeschlagene Aufgaben ehrlich als Fehler, statt eine erfundene Erfolgsbestätigung auszugeben.

**Was sich verbessert:** Bisher konnte eine Firma-Bedingung in einem gelernten Ablauf bei ähnlichen Firmennamen auf die falsche Firma zeigen, und automatisierte Anbindungen scheiterten, wenn sie Workflows mit den von der Schnittstelle angebotenen Tool-Namen lernen wollten. Außerdem gab Louis bei fehlgeschlagenen Schritten gelegentlich eine Erfolgsmeldung mit nicht existierender Bestätigungsnummer aus. Das ist behoben — Bedingungen treffen exakt die genannte Firma, Anbindungen lernen zuverlässig, und Fehler werden klar ausgewiesen.

## 🚀 Release v2.1.11: Zuverlässige KI-Suche & präzise Workflow-Ziele

Mit **2.1.11** findet der KI-Assistent Kontakte, Firmen und Rechnungen zuverlässig über die Namenssuche, und gelernte Workflows treffen exakt die richtigen Einträge: Von „Zeige mir den Kontakt Max Mustermann" bis „lege eine Notiz am Kontakt an" — Antworten und Aktionen stimmen jetzt mit dem tatsächlichen Datenbestand überein.

**Was sich verbessert:** Bisher konnte die Namenssuche im Chat Einträge übersehen, gelernte Workflows gelegentlich Inhalte aus früheren Gesprächen übernehmen und Schritte ohne Zielangabe enden. Das ist behoben — gelernte Abläufe entsprechen der Anweisung, Bedingungen wie „der zur Firma X gehört" werden als Trigger-Bedingung übernommen, und Workflow-Schritte treffen den auslösenden Eintrag.

## 🚀 Release v2.1.10: Zuverlässige Firmenauflösung in automatisierten Abläufen

Mit **2.1.10** funktioniert die Suche nach einer Firma in automatisierten Abläufen wieder zuverlässig: Workflows, die ein Unternehmen anhand seines Namens ermitteln, finden es jetzt korrekt — die Auflösung nutzt das richtige Namensfeld.

**Was sich verbessert:** Bisher schlug die Firmensuche in bestimmten automatisierten Abläufen fehl, wodurch Schritte ohne Zielangabe enden konnten. Das ist behoben.

## 🚀 Release v2.1.9: Anzeigename folgt Namensänderungen zuverlässig

Mit **2.1.9** bleibt der Anzeigename eines Kontakts immer konsistent: **Ändert ihr Vor- oder Nachnamen — in der Oberfläche, über eine Schnittstelle oder in einem automatisierten Ablauf — wird der Anzeigename automatisch neu zusammengesetzt.** Namenskorrekturen sind damit überall sichtbar, nicht nur in den Einzelfeldern.

**Was sich verbessert:** Bisher blieb der Anzeigename nach einer Namensänderung über Schnittstellen unverändert stehen. Zusätzlich ist abgesichert, dass ein übergebener Anzeigename die Namensfelder nicht ungewollt überschreiben kann.

## 🚀 Release v2.1.8: Kontakte mit allen Details — auch über MCP

Mit **2.1.8** können externe Anbindungen — etwa KI-Assistenten oder andere Systeme über MCP — Kontakte jetzt **vollständig anlegen und bearbeiten**: Anrede, Geburtsdatum, Adresse, Zweit-E-Mail, Telefon, Fax und Mobilnummer, Sprache, Labels, Opt-ins für die verschiedenen Kommunikationswege, USt-IdNr., IBAN und BIC, Zahlungsziel, Preisliste und weitere Details — genau die Felder, die auch in der Oberfläche gepflegt werden können.

**Was sich verbessert:** Bisher gingen weitergehende Angaben bei der automatisierten Anlage verloren — das ist jetzt behoben. Alle Felder werden zuverlässig gespeichert, bestehende Kontakte lassen sich mit denselben Details nachpflegen, und Labels können über die Anbindung gesetzt und bei Bedarf auch wieder geleert werden.

## 🚀 Release v2.1.7: Zuverlässige Workflow-E-Mails & saubere Bedingungen

Mit **2.1.7** bekommen eure automatisierten Abläufe endlich die richtigen Inhalte: **E-Mails, die Louis nach einem Ereignis (z. B. Datei-Upload) erstellt, enthalten jetzt den befüllten Text eurer Vorlage** — statt einer leeren oder fehlerhaften Nachricht. Der Entwurf erscheint wie gewohnt zur Freigabe, sofern kein Sofortversand eingestellt ist.

Dazu wird die **Workflow-Ausführung zuverlässiger**: Ergebnisse vorheriger Schritte fließen automatisch in die nachfolgenden Schritte ein, während Warte- und Bedingungs-Schritte exakt wie konfiguriert laufen. Auch Kontakt-Bezüge wie „Lege eine Notiz am Kontakt … an" finden jetzt zuverlässig den richtigen Kontakt.

Und ein kleines Ärgernis ist behoben: Die **Bedingungs-Editoren** im Workflow-Formular nutzen wieder die volle Breite — Auswahlfelder zeigen ihre Beschriftung, Eingabefelder laufen nicht mehr über den Rand hinaus.

## 🚀 Release v2.1.6: Stabile Workflows & vollständige Kontrolle

Mit **2.1.6** bekommt ihr die volle Kontrolle über eure automatisierten Abläufe. Die **Workflow-Liste ist jetzt paginiert** (5/10/20 pro Seite) — auch wer viele Abläufe angelegt hat, behält den Überblick, ohne dass Workflows aus der Sicht verschwinden.

Beim **Workflow-Lernen per Chat** speichert Louis jetzt nur noch eine **saubere, verständliche Beschreibung** statt technischer Prompt-Anteile — und legt den Ablauf **genau einmal** an, ohne versehentliche Duplikate. Bedingungs-Einträge (Trigger-Filter), die aus früheren Versionen oder automatisiert entstanden sind, werden beim Anzeigen **bereinigt**: Workflows mit solchen Bedingungen verschwinden nicht mehr aus der Liste und lassen sich wieder ganz normal bearbeiten.

Louis Smart CRM ist und bleibt ein Projekt für Alle: offen, individualisierbar und mit wachsender Qualität — jede Version wird gründlich geprüft, damit Louis im Alltag zuverlässig für euch arbeitet. Viel Freude damit!

---

## 🚀 Release v2.1.5: Zuverlässige Workflow-Trigger & stabiles Workflow-Lernen

Mit **2.1.5** werden die automatisierten Abläufe endlich **lückenlos auslösbar**: Werden Dateien direkt über die **Kontakt- oder Firmen-Seite** hochgeladen, feuern die hinterlegten Workflow-Trigger jetzt zuverlässig — etwa „Wenn eine Datei mit dem Namen *Businessplan* hochgeladen wird, befülle die Mailvorlage und erstelle eine Draft-Mail“. Zuvor blieb genau dieser direkte Upload stumm, während andere Wege funktionierten.

Zudem lernt **Louis Workflows jetzt zuverlässig per Chat**: Der Auftrag „Lerne einen Workflow: Wenn … hochgeladen, bezahlt oder fällig wird → …“ führt garantiert zum Anlegen des Workflows. Früher konnte Louis die Anweisung gelegentlich nur als Notiz ablegen, ohne den eigentlichen Workflow anzulegen — der Trigger fehlte dann.

Louis Smart CRM ist und bleibt ein Projekt für Alle: offen, individualisierbar und mit wachsender Qualität — jede Version wird gründlich geprüft, damit Louis im Alltag zuverlässig für euch arbeitet. Viel Freude damit!

---

## 🚀 Release v2.1.4: Präzise Automatisierung mit Trigger-Bedingungen

Mit **2.1.4** werden eure automatisierten Workflows deutlich **präziser**: Ereignis-Trigger lassen sich jetzt mit **Bedingungen eingrenzen**. Statt bei jedem Datei-Upload zu starten, könnt ihr festlegen: „Nur wenn die Datei an ein bestimmtes Unternehmen geht **und** der Dateiname auf `.pdf` endet“. Mehrere Bedingungen verbindet ihr wahlweise mit **UND** (alle müssen passen) oder **ODER** (mindestens eine reicht).

Neu ist auch der Trigger **„Datei ins interne Wissen hochgeladen“** — so reagieren Workflows gezielt auf neue Wissensdokumente. Und **Louis kann solche Trigger-Workflows direkt aus dem Chat lernen**: Sagt ihm einfach „Wenn eine Datei an die Firma X hochgeladen wird, lege eine Notiz an“ — Ereignis, Bedingungen und Verknüpfung übernimmt er automatisch.

Zudem wurde die **Testtiefe** weiter erhöht: Die Absicherung der Anmelde- und Sitzungslogik erreicht jetzt die Zielschwelle von 60 % bei den Mutationstests — Louis wird mit jeder Version gründlicher geprüft.

Louis Smart CRM ist und bleibt ein Projekt für Alle: offen, individualisierbar und mit wachsender Qualität — jede Version wird gründlich geprüft, damit Louis im Alltag zuverlässig für euch arbeitet. Viel Freude damit!

---

## 🚀 Release v2.1.3: Runder, konsistenter, schneller bedienbar

Mit **2.1.3** wird Louis Smart CRM in der Bedienung noch runder und konsistenter. Das Herzstück dieser Version: Der **LLM Council** — euer eigenes Multi-KI-Diskussionsforum für strategische Entscheidungen — tritt jetzt im gewohnten Look des gesamten CRM auf. Gleiche Seitenstruktur, gleiche Karten, gleiche Buttons: Wer Louis kennt, findet sich sofort zurecht. Eure vergangenen Debatten bleiben dabei selbstverständlich in der Seitenleiste sichtbar.

Auch beim **E-Mail-Versand** geht es jetzt schneller: Anhänge werden per **Suche** gefunden statt durch lange Listen zu scrollen, und ihr könnt Dateien einfach per **Drag & Drop** in den Dialog ziehen. Ein nerviger Randfall ist ebenfalls behoben — die Anhangs-Auswahl wird nie mehr am Dialogrand abgeschnitten.

Und Louis wird im Alltag noch ein Stück aufmerksamer: Beantwortet er im Chat eine offene **Rückfrage** (z. B. aus einem Workflow), schließt er sie automatisch sauber ab — kein Hängenbleiben im Rückfrage-Pool.

Louis Smart CRM ist und bleibt ein Projekt für Alle: offen, individualisierbar und mit wachsender Qualität — jede Version wird gründlich geprüft, damit Louis im Alltag zuverlässig für euch arbeitet. Viel Freude damit!

---

## 🚀 Release v2.1.0: MCP-Client-Engine, Chatprofile & Qualitätsausbau

Louis Smart CRM wächst dank euch weiter: Mit Version **2.1.0** kommen die neue **MCP-Client-Engine** (49 externe Tools über Google Workspace und Obsidian), **Chatprofile** mit getrennten Verläufen und Tool-Auswahl, sowie ein massiver **Qualitäts- und Testausbau** (Cloud-CI, deterministische KI-Tests) frisch dazu.

Für euch bedeutet das: Noch mehr Möglichkeiten, eine ECHTEN persönlichen Agenten für euer Unternehmen und weitere Zeitersparnisse. Freut euch als nächstes auf eine echte PDF Erkennung (lokal!), ein verbessertes RAG System und viele weitere neue Presets für MCP Anbindungen. 

Für Entwickler: Scheut euch nicht das Louis CRM weiter zu entwickeln - und euere Arbeit mit uns zu teilen. Louis CRM ist und bleibt ein Projekt für Alle, offen und individualisierbar!

---

### 🤖 Louis als Business-Agent — mehr als ein Chat-Bot

Louis ist kein einfacher Chat-Bot mehr, sondern ein **eigener Agent mit Business-Kompetenz**:

* **Delegiert wie ein Team-Lead**: Louis lagert Teilaufgaben an isolierte **Sub-Agenten** aus (bis zu 3 parallel) und bündelt die Ergebnisse — komplexe Analysen werden nebenbei erledigt, während das Gespräch weitergeht.
* **Lernt aus euren Abläufen**: Louis kann Arbeitsabläufe als **Skills** speichern und auf Zuruf wieder abrufen — einmal erklärt, nie wieder neu.
* **Merkt sich Präferenzen**: Langzeit-Memory für eure Arbeitsweise (z. B. „Angebote immer mit 14 Tagen Zahlungsziel") — über Sessions und Chats hinweg.
* **Findet frühere Gespräche wieder**: Volltext-Session-Recall über Titel, Zusammenfassungen und Inhalte — „Was haben wir letzte Woche besprochen?" wird konkret beantwortet.
* **Immer mit Governance**: Alles im CRM-Kontext, mit Freigabepflichten und Audit-Log — Autonomie, aber nie unkontrolliert.

---

### ✨ 1. Neue Funktionen & Highlights

#### 🔌 MCP-Client-Engine (SDK-Umbau)
* **56 externe Tools** über die Client-Engine getestet: Google Gmail (26), Google Kalender (13), Google Drive (1), Obsidian (16).
* **Moderne SDK-Basis**: Umstellung auf `@modelcontextprotocol/sdk` v1.30 — Streamable-HTTP, SSE und HTTPS mit selbstsignierten Zertifikaten.
* **Sichere Token-Verwaltung**: Zugangs-Tokens werden AES-256-GCM-verschlüsselt gespeichert (Secret aus der Container-Umgebung).
* **Stabile Verbindungen**: Fail-Safe-Restarts, Heartbeat-Überwachung und Hard-Timeouts verhindern hängende Server-Prozesse.

#### 🧑‍💼 Chatprofile (getrennte KI-Kontexte)
* **Profil-Auswahl direkt im Chat-Header** — z. B. ein Main-Profil und ein Schalter-Profil mit eigener Tool-Auswahl.
* **Profilgebundener Verlauf**: Warm-Resume lädt beim Öffnen die letzte Session des aktiven Profils.
* **Admin-Freigaben**: Tool-Konfiguration und Profilverwaltung im Admin-Bereich.

#### ⚡ KI-Assistent verfeinert
* **Session-Rotation statt Verlauf-Überschreibung**: Lange Gespräche werden komprimiert, die bisherige Session bleibt als abgeschlossene Eltern-Session erhalten.
* **Besserer Session-Recall**: Volltextsuche mit gewichteter Relevanz (Titel > Zusammenfassung > Verlauf) + Aktualitäts-Bonus.
* **Robustere Tool-Auswahl**: Exakte Namensauflösung verhindert Kollisionen zwischen mehreren MCP-Servern.
* **XML-Sanitizer**: KI-Antworten sind frei von rohen Tool-Call-Formaten.

#### 🧾 E-Rechnung (weiterhin)
* **ZUGFeRD/XRechnung als PDF/A-3**: Referenzvalidierung 5/5 Szenarien (EN 16931, Mustang) — unverändert solide.

---

### 🐛 2. Wichtige Fixes

* **MCP-SDK-Kompatibilität**: Google-Pakete mit `$schema`-Input-Schemas werden über einen Raw-Kompatibilitäts-Fallback korrekt verarbeitet.
* **Engine-Fix im ReAct-Loop**: Verbesserte Fehlerbehandlung und deterministische Tool-Auflösung.
* **Browser-Dialoge**: Neue Dialoge werden serverseitig blockiert — Inline-Bestätigung (2 Stufen) statt `window.confirm`.
* **Test-Infrastruktur**: DB- und Container-Namen sind parametrisierbar — Tests laufen sauber gegen den Wegwerf-Test-Stack.

---

### ⚠️ 3. Bekannte Restrisiken

* **Gmail-Hart-Löschen**: Google erlaubt kein hartes `messages.delete` über die API-Scopes — Trash/Wiederherstellen ist funktionsfähig (bewusste Entscheidung).
* **Tenant-List-Vektor** und **lokaler-LLM-Subtask-Pfad unter Last**: dokumentierte Restlücken.

---

📖 **Dokumentation**: Ausführlicher Changelog in `CHANGELOG.md`, Anwender- und Entwickler-Doku unter `docs/`.

Vielen Dank für euer Vertrauen in Louis Smart CRM! 💙

---

## 🚀 Release v2.0.0: Production-Ready — E-Rechnungen, KI-Agent & Workflow-Automatisierung

Wir freuen uns, das **große 2.0.0-Release** von **Louis Smart CRM** vorzustellen! Das System ist jetzt produktionsreif: rechtskonforme E-Rechnungen, ein vollwertiger KI-Assistent, umfangreiche Automatisierung sowie ein kompletter Sicherheits- und Compliance-Ausbau.

---

### ✨ 1. Neue Funktionen & Highlights

#### 🧾 Rechtskonforme E-Rechnungen (ZUGFeRD 2.2+ / Factur-X 1.0)
* **Automatische PDF/A-3b-Erzeugung**: Jede Rechnung wird als PDF mit eingebettetem, schema-konformem XML erzeugt und gegen **EN 16931** (Mustangproject) validiert.
* **XRechnung B2G**: Öffentliche Auftraggeber werden durch den XRechnung-Export (Single-Line, Multi-Line, gemischte Steuersätze) unterstützt.
* **GoBD-konforme Berechnung**: Rundungs- und Steuerlogik nach finanzrechtlichen Standards (inkl. 0%-Umsatzsteuer-Support).

#### 🤖 KI-Assistent „Louis AI"
* **ReAct-Agentenloop**: Louis versteht freie Sprache und erledigt CRM-Aufgaben im Chat — Kontakte, Firmen, Angebote, Rechnungen, Notizen, Wissensdatenbank.
* **Multi-Provider**: Wählbare LLM-Anbindung (OpenAI, DeepSeek, Anthropic, Gemini — oder lokale Modelle über Ollama), konfigurierbar im Admin-Panel.
* **RAG-Wissensdatenbank**: Firmen- und Kontakt-Vaults werden automatisch indexiert (pgvector) und für fundierte Antworten genutzt.
* **Council-Engine**: Mehrere KI-Modelle deliberieren bei komplexen Entscheidungen.

#### ⚡ Workflow-Automatisierung & DAG-Editor
* **Visueller DAG-Editor**: Komplexe Abläufe mit Verzweigungen, Warte-Schritten und parallelen Knoten im Admin-Bereich erstellen.
* **Intelligente Trigger**: Manuell, ereignisgesteuert (Rechnung bezahlt/überfällig, Kontakt/Firma geändert) oder zeitgesteuert (Cron).
* **Governance-Regeln**: Freigabepflichten (Draft/Approval) für KI-generierte Änderungen — Human-in-the-Loop bleibt Standard.
* **Human-Gate-Instanzen**: Workflows können an definierten Punkten auf manuelle Freigabe warten.

#### 🔌 MCP-Server & KI-Ökosystem-Anbindung
* **42 Katalog-Tools + 3 Prompts**: Vollständiger MCP-Server (JSON-RPC 2.0 / SSE) — externe KI-Clients (Claude Desktop, Cursor, WindSurf, eigene Agents) steuern das CRM direkt.
* **Presets-Katalog**: Bekannte Server (Google Workspace u. a.) per Klick integrieren.
* **Obsidian-MCP**: Vault-Zugriff (Lesen/Schreiben) über das Local REST API Plugin.

#### 🔑 Sicherheit & Compliance
* **Bcrypt-Passwort-Hashing**: Per-User-Salt (Kostenfaktor 10), automatische Migration bestehender Konten beim Login.
* **Session-Sicherheit**: Auth-Secret wird beim ersten Start generiert und sicher in der Datenbank gespeichert.
* **Audit-Log**: Alle Schreibaktionen (CREATE/UPDATE/DELETE) revisionssicher, filterbar und exportierbar.
* **DSGVO-Werkzeuge**: Datenportabilität, Transparenz-Ansichten, Testdaten-Schutz.

---

### 🛠️ 2. Optimierungen & Bugfixes

#### 🌐 Internationalisierung
* **100 % DE/EN**: Alle Oberflächen, Fehlermeldungen und Benachrichtigungen zweisprachig — kein hartkodierter UI-Text mehr.

#### 📞 Kommunikation
* **Telegram Bot Gateway**: Vollwertiger Conversational Co-Pilot mit Zero-Trust-Zugriffskontrolle und Auditierung.
* **Sprachsteuerung**: Whisper-basiertes Speech-to-Text (lokal, DSGVO-konform).

#### ⚙️ Stabilität
* **Council-Sessions**: Anlegen und Fortsetzen von KI-Deliberationen über den MCP-Kanal behoben.
* **Angebots-Finalisierung**: Fehler bei der Belegerstellung mit pg-Datumsfeldern behoben (ISO-konforme Ausgabe).
* **Workflow-Notizen**: `create_note_draft`-Schritte persistieren Notizen zuverlässig in allen Workflow-Pfaden.
* **Docker-Frischstart**: Kompletter Stack (DB, App, Telegram, Whisper, Ollama) startet mit einem Befehl — ohne externe Voraussetzungen.

---

### 📦 Installation

```bash
git clone https://github.com/ren-AI-ssanceDE/Louis-Smart-CRM.git
cd Louis-Smart-CRM
docker compose up --build -d
```

→ App auf `http://localhost:3000` (Login `admin@louis-crm.de` / `admin` — beim ersten Login ändern!). KI-Provider & API-Key werden im Admin-Panel konfiguriert — **keine Datei-Editierung nötig**.

**Ausführliche Dokumentation:** Siehe [`docs/`](https://github.com/ren-AI-ssanceDE/Louis-Smart-CRM/tree/main/docs) im Repository.

---

## 🚀 Release v1.0.1: MCP Integration, Telegram Bot Gateway & Intelligente Workflow-Trigger

Wir freuen uns, euch heute das erste offizielle Update von **Louis Smart CRM** vorstellen zu dürfen! Neben wichtigen Stabilitäts-Optimierungen und Bugfixes in den Bereichen Workflows, Session-Management und E-Rechnungen haben wir mächtige neue Kernfunktionen implementiert, die das CRM noch intelligenter, flexibler und mobiler machen.

---

### 🛠️ 1. Optimierungen & Bugfixes

#### 🌐 Internationalisierung (i18n)
* **100% Übersetzungsstatus**: Die Lokalisierung für die Sprachen **Deutsch** und **Englisch** wurde vollständig finalisiert.
* **Begriffskonsistenz**: Interne Bezeichnungen und Benennungen in der UI wurden systemweit vereinheitlicht.

#### 🧾 Rechnungen & Belege
* **0% Umsatzsteuer-Support**: Ein Fehler wurde behoben, der zuvor bei der Erstellung von steuerfreien Rechnungen (0% USt.) eine Fehlermeldung auslöste. Diese können ab sofort reibungslos und GoBD-konform generiert werden.
* **Erweitertes Rechnungslayout**: Das Rechnungslayout wurde um das dynamische Feld **„Kundenbezeichnung“** erweitert.
* **UI-Polishing**: Kleinere visuelle Darstellungsfehler im Rechnungsmodul wurden beseitigt.

#### 🔑 Login & Session-Management
* **Sicherer Logout**: Es wurde ein Edge-Case behoben, bei dem es im Abmeldevorgang in seltenen Fällen zu Datenbankkonflikten mit der `USER ID` kam. Sessions werden nun sauber terminiert.

---

### ✨ 2. Neue Funktionen & Highlights

#### 🔌 1. Model Context Protocol (MCP) Integration
Mit der Implementierung des modernen **Model Context Protocol (MCP)** öffnet sich Louis Smart CRM für externe KI-Ökosysteme.
* **Asynchrone SSE-Architektur**: Ein maßgeschneiderter MCP-Server ist direkt in das Express-Backend integriert und kommuniziert ressourcenschonend via Server-Sent Events (SSE).
* **Standardisiertes JSON-RPC 2.0**: Befehle, Initialisierungen und Werkzeugaufrufe (`tools/list`, `tools/call`) laufen über ein standardisiertes Protokoll.
* **Kompatibilität mit externen Clients**: Ermöglicht es Editoren und Clients wie *Claude Desktop*, *Cursor* oder *Windsurf*, direkt über natürliche Sprache auf CRM-Werkzeuge zuzugreifen.
* **Sicherheitskonzept (Human-in-the-Loop)**: Über das MCP generierte Entitäten (Kontakte, Firmen, Belege) verbleiben stets im Status `draft` (Entwurf) und erfordern eine manuelle Freigabe im CRM-Adminbereich.

#### ✈️ 2. Lokale Telegram Bot Anbindung (Conversational Co-Pilot)
Steuert euer CRM ab sofort direkt von unterwegs über das Smartphone – ganz ohne mobile Weboberfläche!
* **Echte Konversation statt Befehle**: Dank des integrierten **ReAct-Agentenloops (Reasoning + Acting)** versteht Louis freie deutsche Textanweisungen. Ihr könnt Daten suchen, Umsatzanalysen anfordern oder Rechnungsentwürfe erstellen.
* **Zero-Trust Zugriffskontrolle**: Nur explizit im Administrationspanel freigeschaltete, numerische Telegram-IDs erhalten Zugriff, während unbefugte Anfragen sofort blockiert werden.
* **Lokaler Transport & DSGVO-Konformität**: Die Übertragung läuft vollständig verschlüsselt zwischen eurem lokalen Host/Docker-Container und der offiziellen Telegram API ohne externe Proxy-Server der Entwickler.
* **Transparente Auditierung**: Jeder Zugriff und jede Aktion über Telegram wird namentlich und revisionssicher im CRM-Audit-Log protokolliert.

#### ⚡ 3. Erweiterte automatisierte Workflows & Intelligente Trigger
Die Workflow-Engine (`src/server/ai/workflowEngine.ts`) wurde massiv aufgewertet, um repetitive Geschäftsprozesse vollautomatisch im Hintergrund abzuarbeiten.
* **Drei Workflow-Arten**: Unterstützung von manuellen (`MANUAL`), ereignisgesteuerten (`CRM_EVENT`) und zeitgesteuerten (`TIMER` / Cron-System) Auslösern.
* **Vier neue, intelligente System-Trigger**:
  * 🟢 `invoice.paid`: Zündet sofort, wenn der Zahlungseingang registriert und die Rechnung als "bezahlt" gebucht wird (z. B. für automatischen Mail-Versand).
  * 🔴 `invoice.overdue`: Ein Hintergrund-Scheduler prüft kontinuierlich Fälligkeiten und stößt beim Überschreiten des `due_date` automatisch den Mahnlauf-Entwurf an.
  * 👥 `contact.updated` & 🏢 `company.updated`: Reagiert in Echtzeit auf Stammdatenänderungen zur Absicherung von Konsistenzprüfungen und Audit-Logs.
* **Idempotency Guard (Doppel-Ausführungsschutz)**: Ein zweistufiges Schutzsystem (In-Memory-Sliding-Window für 15 Sekunden + Datenbank-Audit vor dem Start) verhindert zuverlässig Race Conditions und Mehrfachausführungen (z. B. doppelte Mahnungs-Mails).
* **Resiliente Fehlerbehandlung**: Sollte ein Einzelschritt (z. B. wegen eines SMTP-Timeouts) fehlschlagen, wechselt die Instanz kontrolliert in den Zustand `FAILED` und dokumentiert die exakte Ursache im `execution_log`.

---

---

<img width="2064" height="1110" alt="louis_smart_crm_release" src="https://github.com/user-attachments/assets/8033d26b-97c3-4587-868e-033392c28694" />

Wir freuen uns, die allererste stabile Version von **Louis Smart CRM** zu veröffentlichen! Dieses Release liefert ein intelligentes, typsicheres und vollständig gesetzeskonformes CRM-System für den modernen B2B- und B2G-Geschäftsverkehr. Louis SMART CRM wurde speziell für für Solo-Selbstständige, Gründer, Kleinunternehmen und Mini-Teams entwickelt. 

Sichere und rechtskonforme Rechnungen nach europäischen Norm **EN 16931**, des **ZUGFeRD-Standards (2.2+) / Factur-X 1.0** und der deutschen **XRechnung 3.0** (inklusive Leitweg-ID-Validierung für Behörden).

### 🌟 Die Highlights dieses Releases

#### 1. 📊 Echtzeit-Controlling-Dashboard (Bento-Grid)
* **Umsatz-Uhr & Fälligkeits-Radar:** Interaktive Finanzdiagramme (Recharts/D3) zur sofortigen Visualisierung gebuchter Umsatzerlöse und zur Einteilung von Rechnungen nach Fälligkeit (Zahlungsziel vs. Mahnstufen).
* **System-Status-Monitor:** Direkte Live-Rückmeldung über den technischen Zustand der Infrastruktur (Datenbank-Modus, SMTP-Schnittstelle und Audit-Logs).

#### 2. 🤖 Louis AI Copilot (Human-in-the-Loop)
* **Autonomer ReAct-Agentenloop:** Steuerung des gesamten CRM über natürliche Sprache basierend auf Googles Gemini-Modellen.
* **Sicherheits-Guardrail:** Die KI agiert rein entwurfsbasiert. Alle vorgeschlagenen Änderungen werden im `proposedChanges`-Panel gelistet und erst nach expliziter menschlicher Freigabe gebucht oder versendet.
* **QA-Critic-Layer:** Automatische, programmgestützte Plausibilitätsprüfung zur Vermeidung von Berechnungsfehlern und Halluzinationen vor dem Datenexport.

#### 3. 🧾 Rechtssichere E-Rechnungs-Engine
* **Volle Compliance:** Vollständige Erfüllung aller gesetzlichen Anforderungen der europäischen Norm **EN 16931**, des **ZUGFeRD-Standards (2.2+) / Factur-X 1.0** und der deutschen **XRechnung 3.0** (inklusive Leitweg-ID-Validierung für Behörden).
* **Hybrid-Verschmelzung:** Kombination des visuellen PDF-Layouts (`pdf-lib`) mit dem maschinenlesbaren XML-Datenstrom zu einer manipulationssicheren PDF/A-3b Hybriddatei via Mustangproject CLI.
* **Finanzamtskonforme Rundung:** Implementierung einer GoBD-konformen `roundFiscal`-Logik auf Positionsebene zur Vermeidung von Fließkommadifferenzen.

#### 4. 💾 Duales Speicherkonzept (Maximale Resilienz)
* **Produktivbetrieb:** Hochperformanter Zugriff auf eine PostgreSQL-Datenbank mit aktivierter `pgvector`-Erweiterung für semantische KI-Ähnlichkeitssuchen.
* **Offline-Fallback:** Automatisches und geräuschloses Ausweichen auf ein lokales In-Memory-Dateisystem (`.local_fallback_db.json`) bei fehlender DB-Verbindung.

#### 🔒 5. Sicherheit, Transparenz & DSGVO
* **Unveränderbares Audit-Log:** Lückenlose, revisionssichere Append-Only-Aufzeichnung aller sensiblen Nutzeraktionen und autonomen KI-Schritte.
* **DSGVO-Datenportabilität:** Automatisierter 1-Klick-Export aller personenbezogenen Daten als strukturiertes JSON/ZIP-Archiv (Art. 20 DSGVO).
* **Intelligentes Löschkonzept:** Physische Löschung von Kontakten (Art. 17 DSGVO) unter strikter Einhaltung der gesetzlichen 10-jährigen GoBD-Aufbewahrungsfrist für bereits geschriebene Rechnungsdaten.

---

### 🛠️ Technische Voraussetzungen
* **Node.js:** Version `18.x` oder höher (empfohlen `v20.x LTS`).
* **Java Runtime Environment (JRE):** JRE 17 oder höher (globaler `java`-CLI-Pfad für das Mustangproject-Modul).
* **Datenbank:** Eine laufende PostgreSQL-Instanz (v14+ mit `pgvector`) oder direkter Start über das integrierte lokale JSON-Fallback-System.

### 📦 Installations-Quickstart
```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Entwicklungsumgebung starten (nutzt standardmäßig Port 3000)
npm run dev

# 3. Docker-Compose (vorkonfiguriert inkl. PostgreSQL + pgvector)
docker-compose up --build -d


