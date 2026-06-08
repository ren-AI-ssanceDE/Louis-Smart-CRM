# Codierungs-Richtlinien & Schutzregeln für AI-Agents

⏰ **AKTUELLES BEZUGSDATUM**: Dieses Projekt befindet sich auf dem Stand vom **06. Juni 2026**. Alle Lösungsvorschläge, Implementierungen, Bibliotheken und Sicherheitsstandards müssen immer zeitgemäß, modern und zu 100% aktuell bezogen auf dieses Datum sein.

Dieses Dokument definiert verbindliche Verhaltensregeln, Systemvorgaben und geschützte Architekturschichten für alle AI-Entwicklungs-Agents (wie Antigravity, Gemini-Modelle und andere AI-Editoren), die an der Entwicklung von **Louis Smart CRM** mitwirken.

---

## 🔒 DRINGENDE SCHUTZREGELN & ENTWICKLUNGSVERBOTE

### 1. Typ-Sicherheit (TypeScript `any`-Verbot)
* **Kein `any`**: Die Verwendung des unsicheren Typs `any` ist ab sofort im gesamten Projekt **strikt verboten**.
* All Variablen, Parameter, Funktionsrückgaben und Schnittstellen müssen vollständig, präzise und typsicher deklariert werden.
* Falls ein Typ dynamisch oder unbestimmt ist, muss er über `unknown`, Generics (`<T>`) oder passende Interfaces gelöst werden. Bereits existierendes `any`-Vorkommen darf (außer in unvermeidbaren Ausnahmefällen von Fremdbibliotheken) nicht neu eingeführt oder reproduziert werden.

### 2. Konsequente Internationalisierung (i18n-Pflicht)
* **Immer i18n nutzen**: Jede vom Benutzer sichtbare Benutzeroberfläche, Fehlermeldung, Benachrichtigung oder Beschriftung muss über das bestehende i18n-System realisiert werden.
* Statische Texte im Code sind unzulässig. Übersetzungen müssen parallel in den Lokalisierungsdateien gepflegt werden:
  * Deutsch: `/src/i18n/locales/de.json`
  * Englisch: `/src/i18n/locales/en.json`
* Das i18n-Konfigurationssystem der App muss für alle neuen Sprachen, Masken oder Features nahtlos mitgenommen und erweitert werden.

### 3. Verbot von Cloud-Diensten ohne Erlaubnis (Local-Only Standard)
* **Local-Only Standard**: Es dürfen **keinerlei** externen Cloud-Dienste, Web-APIs, Cloud-Datenbanken oder KI-Dienstleistungen (wie Google Gemini, Firebase, externe Analuestools etc.) ohne vorherige und ausdrückliche Freigabe durch den Benutzer im System hinterlegt, aufgerufen oder neu implementiert werden.
* Alle standardmäßigen Funktionalitäten müssen vollständig lokal im Server oder Client ausgeführt werden.
* Falls ein Feature zwingend eine externe API benötigt, muss der AI-Agent vorher via Chat nach einer Freigabe fragen, bevor auch nur eine einzige Zeile Integrationscode geschrieben wird.

### 4. Extrem umsichtiger Umgang mit Docker-Dateien (Erlaubt aber hochsensibel)
* Die Dateien **`Dockerfile.txt`**, **`docker-compose.yml`** und **`docker-entrypoint.sh.txt`** steuern den reibungslosen, lokalen Out-of-the-Box Start des CRM-Systems.
* Änderungen an diesen Dateien sind erlaubt (z.B. für die Orchestrierung zusätzlicher Services wie `telegram-bot-gate`), müssen jedoch mit **absoluter Vorsicht und Umsicht** vorgenommen werden.
* **STRIKTE SCHUTZVORGABE**: Die darin enthaltenden Abschnitte zur headless Java Runtime (JRE 17), zur Ghostscript-Installation sowie zum Download und der Bereitstellung von `mustang-cli.jar` dürfen unter keinen Umständen verändert, auskommentiert oder beschädigt werden. Diese sind die fundamentale Infrastruktur für die E-Rechnungs-Engine. Jede Änderung muss die Docker-Kompatibilität wahren, damit das "Ein Befehl, alles läuft"-Gefühl erhalten bleibt.

---

## 🔒 CRITICAL SYSTEM RULE: SCHUTZ DER E-RECHNUNGS-ENGINE

> ### **DIESER RECHNUNGS-CODE DARF NIE WIEDER ANGERÜHRT WERDEN!**
> Die E-Rechnungs-Erstellungsfunktion und die Mustangproject-Fusion wurden vollständig optimiert, rechtlich abgesichert und auf 100%ige Konformität mit dem Standard **EN 16931 (ZUGFeRD 2.2+ / Factur-X 1.0)** und **PDF/A-3b** perfektioniert.
>
> **Änderungen an diesen Dateien sind AI-Agents STRRENGSTENS untersagt.**

### 1. Gesetzte Sperrdateien (Strictly Read-Only)
Die folgenden Quellcode-Dateien und Komponenten sind **vollständig eingefroren**. AI-Agents dürfen für diese Dateien **unter keinen Umständen** Editierwerkzeuge (`edit_file`, `multi_edit_file`, Code-Überschreibungen, etc.) anwenden:

*   **`src/lib/zugferd.ts`** — Enthält die schema-konforme XML-Datenstrom-Serialisierung und das Berechnungs- und Rundungsverhalten (`roundFiscal` nach GoBD und finanzrechtlichen Standards).
*   **`src/server/pdfHelper.ts`** — Steuert das visuelle PDF-Rendering via `pdf-lib` und die anerkannte, offline-fähige Verschmelzung von PDF und XML über Mustangproject CLI.
*   **`mustang-cli.jar`** (bzw. das entsprechende Executable-Target).
*   **`scripts/PDFA_def.ps`** — Das PostScript-Def-Template für die Ghostscript-PDF/A-Konvertierung (Definiert OutputIntent und sRGB-Farbraum-Zuordnung).
*   **`src/server/routers/invoices.ts`** (nur in Bezug auf den finalen Rechnungsgenerierungs- und Fileserver-Exportfluss).

---

## 🛠️ RESTRIKTIONS-HINTERGRUND (Compliance & Stabilität)
1.  **PDF/A-3b-Konformität**: Jede manuelle Änderung am PDF-Metadaten-Strom (z.B. XMP-Kataloge, OutputIntents, `/AFRelationship` Keys, Trailer-ID-Einträge) zerstört die Konformität für veraPDF-Prüfungen.
2.  **Schema-Validität**: Das zugrundeliegende XML-Schema für ZUGFeRD ist extrem fehleranfällig gegenüber geringfügigen Elementreihenfolgen- oder Tag-Verschiebungen.
3.  **Haftungsausschluss & GoBD-Sicherheit**: Jede automatische Anpassung dieses Codes führt zum sofortigen Erlöschen der Validität und gefährdet die steuerrechtliche Konformität der Rechnungslegung des Anwenders.

---

## 🤖 Anweisung für zukünftige Modell-Aktionen
Wenn ein Benutzer wünscht, die Rechnungsfunktionalität anzupassen, soll der AI-Agent:
1.  Den Benutzer auf diese Richtlinie in der `AGENTS.md` hinweisen.
2.  Erklären, warum eine direkte Änderung das Konformitätssiegel gefährdet.
3.  Vorschlagen, Anpassungen *außerhalb* dieser geschützten System-Schichten vorzunehmen (z.B. UI-Kosmetik am Dashboard, Kundenverwaltung, E-Mail-Templates), anstatt die Kern-Abrechnungs-Engine anzufassen.
