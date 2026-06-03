# Codierungs-Richtlinien & Schutzregeln für AI-Agents

Dieses Dokument definiert verbindliche Verhaltensregeln, Systemvorgaben und geschützte Architekturschichten für alle AI-Entwicklungs-Agents (wie Antigravity, Gemini-Modelle und andere AI-Editoren), die an der Entwicklung von **Louis Smart CRM** mitwirken.

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
*   **`Dockerfile` / `docker-compose.yml`** — Enthält die minimalisierte headless Java Runtime (JRE 17) sowie den Download und die Bereitstellung von `mustang-cli.jar`. Dies ist die fundamentale Engine-Infrastruktur.
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
