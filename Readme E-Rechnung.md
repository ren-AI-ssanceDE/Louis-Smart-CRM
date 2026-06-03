# 🧾 Wiki: E-Rechnungs-Engine (ZUGFeRD & Factur-X)

Die E-Rechnungs-Engine von **Louis Smart CRM** ist der rechtssichere Kern des gesamten Abrechnungssystems. Sie erfüllt alle strengen gesetzlichen Anforderungen der **europäischen Norm EN 16931**, des **ZUGFeRD-Standards (2.2+ / Factur-X 1.0)** und der deutschen **XRechnung (KoSIT 3.0)**. 

Ab dem 1. Januar 2025 gilt in Deutschland eine flächendeckende E-Rechnungspflicht für inländische B2B-Umsätze – diese Engine stellt die vollständige Gesetzeskonformität sicher.

---

## 🔒 1. Kritische Sicherheitsregel (Read-Only Schutz)

> ### 🛑 **DIESER CODE DARF NIE MEHR VERÄNDERT WERDEN!**
> Die XML-Generierung, die PDF/A-Konvertierung und die Mustangproject-Fusion sind nach **EN 16931** und **PDF/A-3b** vollständig zertifiziert und durch veraPDF-Prüfungen abgesichert. 
>
> Jede Modifikation an diesen Komponenten zerstört die rechtssichere Validität und führt zum **Erlöschen des Konformitätssiegels** nach GoBD.

Die folgenden Dateien sind für alle manuellen oder autonomen AI-Agents **streng lesegeschützt (Read-Only)**:
- **`src/lib/zugferd.ts`**: Die XML-Datenstrom-Serialisierung und GoBD-konforme Rundungslogik (`roundFiscal`).
- **`src/server/pdfHelper.ts`**: Das visuelle PDF-Rendering via `pdf-lib` und die Mustangproject CLI-Kopplung.
- **`Dockerfile` / `docker-compose.yml`**: Die Bereitstellung der Java JRE 17 headless Umgebung und Mustang CLI.
- **`scripts/PDFA_def.ps`**: Das PostScript-Def-Template für die sRGB-Farbraum-Zuordnung zur Einhaltung des ISO-Standards.

---

## 🏗️ 2. Technischer Workflow der Rechnungserstellung

Die Rechnungsgenerierung kombiniert den visuellen, für Menschen lesbaren Teil (PDF) mit dem maschinenlesbaren Datenstrom (XML) zu einer einzigen, manipulationssicheren PDF/A-3b Hybriddatei.

```
┌────────────────────────────────┐
│      Rechnungsdaten (CRM)      │
└───────────────┬────────────────┘
                ├────────────────────────────────────────┐
                ▼ (zugferd.ts)                           ▼ (pdf-lib)
  ┌───────────────────────────┐            ┌───────────────────────────┐
  │ Generierung CII-XML       │            │ Visuelles PDF (A4)        │
  │ (Comfort / XRechnung 3.0) │            │ (Layout & Positionierung) │
  └─────────────┬─────────────┘            └─────────────┬─────────────┘
                │                                        │
                └───────────────────┬────────────────────┘
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

### Der Prozess im Detail:
1. **XML-Erstellung (`src/lib/zugferd.ts`)**: 
   Die Rechnungsdaten und Positionszeilen werden in das CII-Syntaxschema (*Cross Industry Invoice*) konvertiert. Es wird entweder das Profil `comfort` (ZUGFeRD EN 16931) oder `xrechnung-3.0` (für B2G) generiert.
2. **PDF-Erstellung (`src/server/pdfHelper.ts`)**:
   Das visuelle Standard-Layout wird über `pdf-lib` dynamisch gezeichnet. Es berechnet selbstständig Zeilenumbrüche, Tabellenhöhen und Seitenanzahlen.
3. **Konvertierung und Verschmelzung (`Mustangproject`)**:
   Über einen lokalen Systemaufruf (CLI) wird das freigegebene XML-Dokument als standardisierter Anhang (`factur-x.xml`) in das PDF-Dokument eingebettet. Gleichzeitig werden Metadaten (XMP-Schema, OutputIntent) injiziert, um die **PDF/A-3b (ISO 19005-3)** Validierung zu gewährleisten.

---

## 🧮 3. Mathematische Rundung & GoBD-Richtlinien

Ein typischer Fehler bei der Rechnungserstellung sind Differenzen im Nachkommastellbereich durch fehlerhafte Fließkommarundung. Louis Smart CRM implementiert in `src/lib/math.ts` die finanzamtskonforme Rundungsfunktion `roundFiscal`:

```typescript
export function roundFiscal(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
```

### Rundungsregeln für Mehrzeilenbelege:
* **Positions-Netto**: Stückpreis × Menge, anschließend kaufmännisch gerundet auf 2 Dezimalstellen.
* **Misch-Mehrwertsteuersätze**: getrennte Kumulierung der Netto-Beträge je Steuersatz (z.B. 19% und 7%), Steuerrechnung auf die Summen, danach kaufmännische Rundung.
* **Steuertoleranz-Check**: Der QA-Critic-Layer prüft vor dem XML-Export, ob Netto-Summe + Umsatzsteuer-Summe exakt dem Brutto-Gesamtbetrag entsprechen. Abweichungen über 1.5 Cent blockieren das Speichern automatisch.

---

## 🏛️ 4. XRechnung v3.0 (B2G-Schnittstelle)

Für Rechnungen an staatliche Stellen und Behörden (Business-to-Government – B2G) fordert das System zwingend zusätzliche Felder zur Leitwegsteuerung:
* **Leitweg-ID (Buyer Reference)**: Dient der Adressierung der Behörde. Validiert in `zugferd.ts` mit folgendem regulären Ausdruck:
  ```typescript
  const LEITWEG_ID_REGEX = /^\d{2,12}(-[A-Z0-9]{1,30})?(-\d{2})?$/i;
  ```
* **Verkäufer-Kontakt (Seller Contact)**: Gemäß EN 16931 (BT-41, BT-42, BT-43) muss ein personifizierter Kontakt mit Name, Telefonnummer und E-Mail-Adresse existieren, andernfalls wirft das System vor der XML-Übermittlung einen validierten Fehler aus.

---

## 📂 5. E-E2E Validierungsprüfung

Um die Qualität und Konformität zu jedem Zeitpunkt im Build-Prozess sicherzustellen, enthält das System ein End-to-End-Testskript unter `scripts/e2e-validate.ts`. Es simuliert:
1. Rechnungsstellung mit Einzelpositionen (`01-zugferd-single-line`).
2. Mehrzeilige Rechnungsstellung (`02-zugferd-multi-line`).
3. Rechnungsstellung mit gemischten Mehrwertsteuersätzen (`03-zugferd-mixed-vat`).
4. XRechnung B2G inklusive valider Leitweg-IDs (`04-xrechnung-b2g`).

Das Testergebnis wird strukturiert unter `/e2e-out/summary.json` aufgeführt und kann für CI/CD-Pipeline-Audits ausgelesen werden.
