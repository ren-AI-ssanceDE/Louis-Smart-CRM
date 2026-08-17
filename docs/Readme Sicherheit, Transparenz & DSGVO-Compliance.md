# 🔒 Sicherheit, Transparenz & DSGVO-Compliance

> Louis Smart CRM ist so gebaut, dass Ihre **Daten sicher, nachvollziehbar und gesetzeskonform** verarbeitet werden — DSGVO und GoBD eingeschlossen. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Ihre Daten — sicher und in Ihrer Hand

* **Lokal oder in Ihrer Cloud:** Das System läuft bei Ihnen (eigener Rechner/Server) — Ihre Kundendaten und Rechnungen verlassen Ihr Haus nicht, außer Sie richten es anders ein.
* **Zugang nur mit Anmeldung:** Jeder Benutzer hat ein eigenes Konto; nur Berechtigte sehen die Daten.
* **Zugangsdaten bleiben geheim:** Passwörter und KI-Schlüssel werden niemals im Browser angezeigt oder in Berichten ausgegeben.
* **Mandanten-Trennung:** Nutzen mehrere Firmen dasselbe System, sieht jede nur ihre eigenen Daten.

## Transparenz: Das Sicherheitsprotokoll (Audit-Log)

Das System führt ein **lückenloses, unveränderbares Protokoll** aller wichtigen Vorgänge:

* Wer hat wann einen Kunden angelegt, geändert oder gelöscht?
* Wer hat eine Rechnung erstellt, freigegeben oder exportiert?
* Was hat der KI-Assistent vorgeschlagen — und wer hat freigegeben?
* Wann wurde eine E-Mail versendet?

**Das Protokoll kann niemand nachträglich ändern oder löschen** — auch nicht der Administrator. So ist jederzeit nachweisbar, was im System passiert ist (Revisionssicherheit, GoBD).

## Ihre Rechte nach DSGVO — im System umgesetzt

| Ihr Recht | So erfüllt es das System |
|---|---|
| **Datenübertragbarkeit (Art. 20)** | Ein-Klick-Export aller Daten einer Person/Firma als ZIP/JSON — maschinenlesbar |
| **Löschung (Art. 17)** | Kontakte/Firmen löschbar — mit gesetzlicher Ausnahme: Rechnungen müssen 10 Jahre aufbewahrt werden (GoBD) und werden daher nur datenschutzkonform anonymisiert, nie spurlos gelöscht |
| **Auskunft** | Das Audit-Log und der Export liefern Ihnen alle Informationen |

## KI-Sicherheit: Louis kann nicht von alleine handeln

* **Jede Änderung braucht Ihre Freigabe** (Freigabe-Karten, Draft-Flow) — Louis kann nichts speichern, buchen oder versenden ohne Sie.
* **Rückfragen statt Raten:** Wenn Louis unsicher ist, fragt er nach.
* **Qualitätskontrolle:** Vor jeder Übernahme prüft eine eingebaute Prüfinstanz (QA-Critic) Mathematik, Pflichtfelder und Bankdaten-Konsistenz.
* **KI-Governance:** Schreibende Aktionen sind technisch als „schreibend“ markiert und werden abgefangen.

## Datenschutz bei Tests

Die Entwicklungs- und Testteams arbeiten ausschließlich mit **Testdaten** (z. B. „Test Testkunde“) — echte Kontakte und Firmen werden für Tests niemals verwendet.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Unveränderbares Audit-Log (System-Transparenz)

Jede sensible Nutzeraktion, jeder API-Call und jeder autonome Schritt von Louis AI wird in `sys_audit_log` aufgezeichnet:

* Erstellung, Bearbeitung oder Löschung von Firmen, Kontakten, Angeboten
* Generierung, Verifizierung oder Export von E-Rechnungen
* AI-Toolaufrufe (inkl. Konfidenzwert, Initiator: Agent vs. Mensch)
* SMTP-Verbindungstests und Mail-Versand-Metadaten
* Telegram-Zugriffe, MCP-Aufrufe, Workflow-Ausführungen

Das Log wird im Admin-Bereich visualisiert (`src/components/admin/AuditLogTable.tsx`). Es ist **rein anfügend (Append-Only)** — selbst Administratoren können Einträge im regulären Betrieb nicht modifizieren oder löschen (Revisionssicherheit).

## 2. DSGVO-Datenportabilität (Art. 20)

* **Ein-Klick-Export**: Der DSGVO-Tab (`src/components/admin/DataPortabilityTab.tsx`) erzeugt ein maschinenlesbares **ZIP-Archiv** (jszip) oder eine strukturierte JSON-Datei.
* **Umfang**: Personenstammdaten, Historien, verknüpfte E-Mails, Rechnungsverläufe, Metadaten.
* **Nutzen**: Erfüllung des Rechts auf Datenübertragbarkeit vollautomatisch in Sekunden.

## 3. Löschkonzept & „Recht auf Vergessen“ (Art. 17)

1. **CRM-Kontakte/Firmen**: Vollständig löschbar, sofern keine Rechnungsverbindlichkeiten bestehen; bei Firmenlöschung bleiben Kontakte erhalten (`associated_company_id` → `null`).
2. **Rechnungen & Buchhaltungsdaten**: Nach GoBD **nicht** löschbar (10 Jahre Aufbewahrungspflicht).
3. **Kaskadierendes Verhalten**: Wird ein Kontakt gelöscht, behält die historische Rechnung ihre Integrität — Adressdaten bleiben im XML/PDF-Metadatenstrom archiviert, während der CRM-Aktivitätsbereich anonymisiert wird.
4. **DSGVO-Export vor Löschung**: Export (Art. 20) ist jederzeit vor der Löschung möglich.

## 4. Schutz von Secrets & Drittanbieter-Schlüsseln

* **Kein Client-Zugriff**: Der Browser lädt niemals Passwörter oder API-Keys — alle externen Aufrufe (Gemini, SMTP, MCP, STT) laufen serverseitig über tRPC/REST.
* **`.env`-Datei**: Umgebungsvariablen bleiben im Docker-Container/der Laufzeitumgebung; Git ist ausgeschlossen (`.gitignore`).
* **Maskierung**: SMTP-Passwörter etc. werden in Fehlermeldungen/Logs maskiert (`***`).
* **MCP-API-Keys**: Der MCP-Server-Endpunkt ist durch `mcpAuthMiddleware` (API-Key) abgesichert; OAuth-Tokens für externe MCP-Server liegen verschlüsselt in `sys_mcp_*`.

## 5. Zero-Trust & Mandanten-Isolation

* **Mandantenfähigkeit**: Alle Daten sind über `tenant_id` isoliert; Queries filtern `WHERE ... AND (tenant_id = $2 OR tenant_id = '1')`.
* **Telegram-Gateway**: Zero-Trust-Allowlist (nur freigeschaltete Chat-IDs).
* **Vault-Governance** (`vaultStore.ts` / obsidian-mcp@2): Lesen blockiert `Privat/`; Schreiben blockiert `Privat/` und `RO/`, erlaubt nur `_louis/`, `.md`-Pflicht, Path-Traversal-Schutz (`..`, absolute Pfade, NUL).

## 6. KI-Governance (Human-in-the-Loop)

* **Draft-Flow**: Alle schreibenden KI-Aktionen erzeugen Freigabe-Entwürfe (`proposedChanges`) — kein direkter DB-Write.
* **WRITE_ACTION_MAP**: Schreib-Tools (CREATE/UPDATE/DELETE) sind governance-registriert.
* **`ask_user_question`**: Rückfragen an den Benutzer sind persistiert und blockieren die Ausführung, bis beantwortet.
* **QA-Critic**: Vor jeder Übernahme prüft der deterministische Critic Mathematik, Pflichtfelder und IBAN-Konsistenz; ein Compliance-LLM-Pass bewertet Tonfall, Vollständigkeit und DSGVO-Konformität.
* **Datenschutz-Regel für Tests**: QA-Szenarien laufen ausschließlich mit Testdaten (Musterfirma GmbH, „Test Testkunde“) — niemals mit echten Kontakten/Unternehmen.

## 7. Compliance-Standards

| Standard | Umsetzung |
|---|---|
| **DSGVO** | Art. 17 (Löschung), Art. 20 (Portabilität), Art. 5/32 (Security by Design) |
| **GoBD** | Append-Only-Audit-Log, 10-jährige Aufbewahrung, revisionssichere Belege |
| **EN 16931** | ZUGFeRD 2.2+ / Factur-X 1.0, XRechnung 3.0 (B2G) |
| **PDF/A-3b** | ISO 19005-3, veraPDF-geprüft, zertifizierte Kernkomponenten (Read-Only) |
