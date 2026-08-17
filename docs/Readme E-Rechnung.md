# 🧾 E-Rechnungs-Engine (ZUGFeRD & Factur-X)

> Die Rechnungs-Engine von Louis Smart CRM erstellt **gesetzlich konforme elektronische Rechnungen** — für Unternehmen und Behörden. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist eine „E-Rechnung“ und warum ist das wichtig?

Seit dem **01.01.2025** sind Unternehmen in Deutschland verpflichtet, Rechnungen an andere Unternehmen (B2B) elektronisch zu empfangen — und ab 2027/2028 auch elektronisch zu versenden. Eine E-Rechnung ist kein einfaches PDF, sondern eine Datei mit **maschinenlesbaren Daten** (wie eine strukturierte Excel-Datei für Rechnungsinhalte), damit sie automatisch verarbeitet werden kann.

**Louis Smart CRM macht das für Sie automatisch** — Sie geben Ihre Rechnung wie gewohnt ein, und das System erzeugt das richtige Format:

* **ZUGFeRD / Factur-X** — das Standardformat für Rechnungen an Unternehmen: eine PDF-Datei, die Menschen lesen können UND die maschinenlesbaren Daten eingebettet enthält (ein „Hybrid“).
* **XRechnung** — das Format für Rechnungen an **Behörden** (B2G), z. B. Bund, Länder, Kommunen.

## Was passiert automatisch?

1. Sie erstellen die Rechnung im System (oder lassen Louis einen Entwurf machen).
2. Das System prüft, ob alle **Pflichtangaben** vorhanden sind (Steuernummer, Bankverbindung, vollständige Adressen, bei Behörden die Leitweg-ID).
3. Es berechnet alle Beträge **steuerlich korrekt** (inkl. gemischter Mehrwertsteuersätze wie 19 % und 7 %) und rundet nach Finanzamtsregeln.
4. Es erzeugt die fertige Hybrid-PDF — **prüfbar, revisionssicher, rechtssicher**.

## Was müssen Sie tun?

**Nichts Besonderes.** Nur sicherstellen, dass Ihre Firmendaten (Name, Steuernummer, IBAN, Logo) im Admin-Bereich unter **„Mein Unternehmen“** vollständig gepflegt sind. Bei Behördenrechnungen tragen Sie zusätzlich die **Leitweg-ID** des Empfängers ein — das System validiert sie automatisch.

## Gut zu wissen

* **Rechnungen sind unveränderbar:** Sobald eine Rechnung finalisiert ist, kann sie nicht mehr gelöscht oder überschrieben werden (gesetzliche Aufbewahrungspflicht: 10 Jahre). Das ist gewollt und gesetzlich vorgeschrieben.
* **Die Rechnungs-Engine ist zertifiziert** und darf von niemandem verändert werden — auch nicht vom KI-Assistenten. Das garantiert, dass Ihre Rechnungen immer rechtskonform sind.
* **Freigabe durch Sie:** Rechnungsentwürfe von Louis werden erst nach Ihrer Bestätigung finalisiert und versendet.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Kritische Sicherheitsregel (Read-Only Schutz)

> ### 🛑 DIESER CODE DARF NICHT VERÄNDERT WERDEN
> Die XML-Generierung, die PDF/A-Konvertierung und die Mustangproject-Fusion sind nach **EN 16931** und **PDF/A-3b** zertifiziert (veraPDF-geprüft). Jede Modifikation zerstört die rechtssichere Validität und führt zum **Erlöschen des Konformitätssiegels** nach GoBD.

Strikt lesegeschützt für manuelle und autonome Änderungen (CI-guard-gesichert):
- **`src/lib/zugferd.ts`** — CII-XML-Serialisierung, GoBD-konforme Rundung, Leitweg-ID-Validierung
- **`src/server/pdfHelper.ts`** — PDF-Rendering (pdf-lib) + Mustangproject-CLI-Kopplung
- **`Dockerfile` / `docker-compose.yml`** — Java-JRE-17-headless-Umgebung
- **`scripts/PDFA_def.ps`** — PostScript-Def-Template (sRGB-Farbraum, ISO-Standard)

## 2. Technischer Workflow der Rechnungserstellung

```
┌────────────────────────────────┐
│      Rechnungsdaten (CRM)      │
└───────────────┬────────────────┘
                ├──────────────────────────────────────┐
                ▼ (zugferd.ts)                         ▼ (pdf-lib)
  ┌───────────────────────────┐          ┌───────────────────────────┐
  │ Generierung CII-XML       │          │ Visuelles PDF (A4)        │
  │ (Comfort / XRechnung 3.0) │          │ (Layout & Positionierung) │
  └─────────────┬─────────────┘          └─────────────┬─────────────┘
                └───────────────────┬──────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │     Mustangproject CLI        │
                    │   (Fusioniert PDF & XML)      │
                    └───────────────┬───────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  Valide PDF/A-3b Hybriddatei  │
                    │   (Bereit zum E-Mail Versand) │
                    └───────────────────────────────┘
```

### Ablauf im Detail
1. **XML-Erstellung** (`src/lib/zugferd.ts`): Konvertierung der Rechnungsdaten in CII-Syntax — Profil `comfort` (ZUGFeRD EN 16931) oder `xrechnung-3.0` (B2G). Vorab **Pre-Flight-Validierung** (USt-IdNr/Steuernummer, vollständige Adressen, Bankverbindung, Leitweg-ID).
2. **PDF-Erstellung** (`src/server/pdfHelper.ts`): Dynamisches Zeichnen über pdf-lib (Zeilenumbrüche, Tabellenhöhen, Seitenanzahl, Logo des eigenen Unternehmens).
3. **Fusion** (Mustangproject CLI): Einbettung des XML als `factur-x.xml`-Anhang + XMP-Metadaten/OutputIntent → **PDF/A-3b (ISO 19005-3)**.
4. **Zugriff**: `GET /api/invoices/:invoiceId/download-pdf` bzw. `download-xml`.

## 3. Mathematische Rundung & GoBD-Richtlinien

`src/lib/math.ts` implementiert die finanzamtskonforme Rundungsfunktion `roundFiscal`:

```typescript
export function roundFiscal(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
```

* **Positions-Netto**: Stückpreis × Menge, kaufmännisch auf 2 Dezimalstellen gerundet.
* **Misch-Mehrwertsteuersätze**: Netto-Beträge je Steuersatz (19 %/7 %) getrennt kumuliert, Steuer auf Summen, dann Rundung.
* **Steuertoleranz-Check**: Der QA-Critic prüft vor dem Export `Netto + USt = Brutto`; Abweichungen > 1,5 Cent blockieren das Speichern automatisch.

## 4. XRechnung v3.0 (B2G-Schnittstelle)

* **Leitweg-ID (Buyer Reference)**: Validierung in `zugferd.ts` per Regex:
  ```typescript
  const LEITWEG_ID_REGEX = /^\d{2,12}(-[A-Z0-9]{1,30})?(-\d{2})?$/i;
  ```
* **Verkäufer-Kontakt** (EN 16931 BT-41/42/43): personifizierter Kontakt mit Name, Telefon und E-Mail — sonst validierter Fehler vor XML-Übermittlung.

## 5. E2E-Validierungsprüfung

`scripts/e2e-validate.ts` (`npm run test:zugferd`) simuliert und prüft:
1. Rechnungsstellung mit Einzelpositionen (`01-zugferd-single-line`)
2. Mehrzeilige Rechnung (`02-zugferd-multi-line`)
3. Gemischte Mehrwertsteuersätze (`03-zugferd-mixed-vat`)
4. XRechnung B2G mit validen Leitweg-IDs (`04-xrechnung-b2g`)

Ergebnisse: strukturiert unter `/e2e-out/summary.json` (für CI/CD-Audits).

## 6. Integration in den Draft-Flow & Workflows

* Rechnungsentwürfe (auch KI-erzeugt) laufen über den **einheitlichen Freigabe-Flow**: Louis AI erstellt `proposedChanges` → Freigabe im Chat/Approvals-Panel → DB-Write mit vollständigen Feldern.
* Workflow-Aktionen können Rechnungs-E-Mails vorbereiten (`SendEmail` mit `direct_send_email: false` → `WAITING_FOR_DRAFT_APPROVAL`).
* Status-Events (`invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.overdue`) triggern Workflows (z. B. automatischer Mahnlauf).
