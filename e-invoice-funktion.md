# Strategischer Umsetzungsplan: E-Rechnungskonformität via Mustangproject-Architektur

**Projekt:** Louis Smart CRM (Semantic E-Invoicing Edition)  
**Rolle:** Senior Fullstack-Entwickler & Software-Architect  
**Status:** Detaillierter Sanierungsplan (Richtungsweisend für 100%ige Konformität)  
**Referenzdokument:** `AI_CONTEXT.md` (Punkte 2 & 6 als absolute "Source of Truth")

---

## 1. Ausgangssituation & Motivation (Audit-Ergebnis)

Die Konformitätsprüfung der durch die händische Low-Level-Manipulation von `pdf-lib` generierten Rechnungen lieferte strukturelle Mängel bei der PDF/A-3b-Konformität (veraPDF-Fehler wie fehlender `/AFRelationship`-Key im Dateispezifikations-Katalog, fehlender Trailer-`ID`-Eintrag, ungültige XMP-Metadaten) und im XML-E-Invoicing-Schema (KoSIT-Fehler bei Profil-Angaben und leeren Liefertags).

Um **100%ige Konformität mit dem Standard EN 16931 (ZUGFeRD 2.2+ / Factur-X 1.0)** zu garantieren und gleichzeitig die strengen Datenschutzvorgaben (**zero-egress, 100% offline-fähig/lokal**) einzuhalten, wird gemäß **AI_CONTEXT.md (Punkt 2: Tech Stack & Punkt 6: Primary Business Logic)** der Einbau des **Mustangproject CLI** über eine leichtgewichtige Headless Java-Runtime-Schicht im Docker-Container geplant. Mustangproject ist die anerkannte Open-Source-Finanz-Referenzbibliothek für die ZUGFeRD-Verschmelzung. 

Dies befreit das CRM von fehleranfälligen manuellen Bytemanipulationen und liefert ohne externen Cloud-Verkehr rechtssichere, zertifizierte E-Rechnungen.

---

## 2. Architektonischer Zielzustand (Hybrid Architecture)

Der neue hybride Workflow zur Rechnungserzeugung gliedert sich wie folgt:

```
+-----------------------------------+
|  1. Rechnungsdaten (Zod Schema)   |
+-----------------------------------+
                  |
         +--------+--------+
         |                 |
         v                 v
+------------------+ +-------------------------+
|  Visuelle PDF    | |   ZUGFeRD XML           |
|  (pdf-lib, ohne  | |   (src/lib/zugferd.ts,  |
|  low-level XML)  | |   schema-konform)       |
+------------------+ +-------------------------+
         |                 |
         +--------+--------+ (Temp-Dateien auf Platte)
                  |
                  v
+----------------------------------------------+
|       Mustangproject CLI (Local Execution)   |
|  Führt PDF und XML zusammen, konvertiert zu  |
|  valider PDF/A-3b-Struktur & injiziert XMP   |
+----------------------------------------------+
                  |
                  v
+----------------------------------------------+
|  GoBD- & EN 16931-konforme Hybrid-E-Rechnung |
|  Save: /companies_data_vault (bzw. contacts) |
+----------------------------------------------+
```

---

## 3. Infrastruktur-Anpassungen (docker-compose & Dockerfile)

Mustangproject erfordert ein leichtgewichtiges headless Java Runtime Environment (JRE). 

### 3.1 Anpassung der `Dockerfile`
Zur Bereitstellung der JRE und der Mustangproject CLI wird das `Dockerfile` der Node-Anwendung modular umgestellt. Das Image basiert weiterhin auf einem schlanken Node-Image, installiert jedoch die minimal erforderliche Java-Schicht:

```dockerfile
# Dockerfile
FROM node:20-slim

# 1. Systemabhängigkeiten installieren (Java für Mustangproject unkomprimiert hinzufügen)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Mustangproject CLI herunterladen (v2.12.0 LTS oder aktuellere stabile Version)
# Lokale Speicherung im App-Verzeichnis für direkten Zugriff
RUN curl -L -o /app/mustang-cli.jar https://github.com/ZUGFeRD/mustangproject/releases/download/v2.12.0/mustang-cli-2.12.0.jar

# 3. Paketdateien kopieren und npm install ausführen
COPY package*.json ./
RUN npm ci --omit=dev

# 4. Quellcode kopieren und Build durchführen
COPY . .
RUN npm run build

EXPOSE 3000

# Start-Kommando
CMD ["npm", "start"]
```

### 3.2 Anpassung der `docker-compose.yml`
Es sind keine drastischen Port- oder Containeränderungen in `docker-compose.yml` notwendig. Das lokale Verzeichnis `/app/companies_data_vault` und `/app/contacts_data_vault` wird weiterhin nahtlos gemounted. Einzig die Installation des JRE erhöht das Image minimal, repariert dafür aber jegliche PDF/A-Kompatibilität vollautomatisch.

---

## 4. Softwareseitige Implementierung (Refactoring-Plan)

### 4.1 Korrekturen in der XML-Generierung (`src/lib/zugferd.ts`)
Wir beheben die fehlerhafte Deklaration des Liefertag-Blocks und stimmen das Basic-Profil optimal auf die Anforderungen der Standard-ZUGFeRD Validierung ab.

```typescript
// Geplante Änderung in src/lib/zugferd.ts
// Behebung des leeren ram:ApplicableHeaderTradeDelivery Tags:
// Ersetzung des alten <ram:ApplicableHeaderTradeDelivery/> durch:

<ram:ApplicableHeaderTradeDelivery>
    <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
            <udt:DateTimeString format="102">${(invoice.service_date || invoice.issue_date || '').replace(/-/g, '')}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
    </ram:ActualDeliverySupplyChainEvent>
</ram:ApplicableHeaderTradeDelivery>
```
Ebenso wird sichergestellt, dass die Umsatzsteuercodes (`S`) und Kategorien (`VAT`) für jede Zeile (`IncludedSupplyChainTradeLineItem`) sauber transportiert werden, um Rundungsdifferenzen im Steuergitter zu unterbinden.

---

### 4.2 Vereinfachung und Umstellung von `pdfHelper.ts`
Die komplexe und fehleranfällige Low-Level-Befüllung des PDF-Trailers und der Metadaten-Objekte in `pdfHelper.ts` (Z. 651-795) entfällt vollständig. 

Wir delegieren diese systemische Sorge an die Mustangproject CLI. Die Schrifteinbettung (`Lato-Regular.ttf`, `Lato-Bold.ttf`) bleibt in `pdf-lib` aktiv, damit das visuelle Rendering elegant aufgebaut wird.

```typescript
// Geplantes Design des Integrations-Codes in src/server/pdfHelper.ts (Auszug)
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

export async function mergePdfAndXmlWithMustang(
  visualPdfPath: string, 
  xmlPath: string, 
  outputPath: string
): Promise<void> {
  const jarPath = path.join(process.cwd(), "mustang-cli.jar");
  
  // Mustangproject CLI-Kommando für ZUGFeRD / Factur-X Verschmelzung (ZUGFeRD Version 2 / Factur-X 1.0)
  // --action combine integriert die XML-Inhalte inklusive aller korrekten PDF/A-3b Tags,
  // Metadatenschlüssel (OutputIntent, AF-Beziehungen), XMP-Kataloge und Trailer ID Keys.
  const cmd = `java -jar "${jarPath}" --action combine --source "${visualPdfPath}" --source-xml "${xmlPath}" --out "${outputPath}" --version 2`;
  
  try {
    await execAsync(cmd);
    console.log(`[MustangPDF] Successfully embedded E-Invoice XML using Mustang CLI.`);
  } catch (error) {
    console.error("[MustangPDF] Error running Mustang CLI fusion process:", error);
    throw new Error("Mustang E-Invoicing fusion failed.");
  }
}
```

#### Der neue Generierungsfluss in `generateInvoiceFilesOnDisk`:
1. **XML generieren:** Wie gewohnt die XML-Datenstrom-Serialization aus `generateZugferdXML(...)` in einer temporären Datei `zugferdTemp.xml` oder direkt an der Zielstelle ablegen.
2. **Standard-Visual-PDF generieren:** Ein reines visuelles PDF (ohne Low-Level Injektion) mittels `pdf-lib` erzeugen und als `visualTemp.pdf` zwischenspeichern.
3. **Mustang-Fusion triggern:** Die Funktion `mergePdfAndXmlWithMustang` aufrufen, welche das visuelle PDF und die XML-ZUGFeRD-Daten robust miteinander verschmilzt und das gesiegelte, PDF/A-3b-konforme PDF-Endprodukt an die finalen Stellen exportiert:
   - `/companies_data_vault/.../rechnung_RE-202X-XXX.pdf`
   - `/companies_data_vault/.../invoices/invoice_UUID.pdf` (für Abwärtskompatibilität des FileBrowsers)
4. **Bereinigung:** Temporäre Arbeitsdateien löschen.

---

## 5. Anpassung der Dokumentation (`quick_start.md`)

Damit die Entwickler und Systemadministratoren nach der Umstellung fehlerfrei arbeiten können, wird in der `quick_start.md` folgender wichtiger Hinweis integriert:

*   **Lokaler Entwicklungs-Modus (Variante A):** Für die lokale Rechnungserstellung muss auf dem Hostrechner ein Java Development Kit (JDK/JRE 11 oder höher) installiert sein (`java` im globalen Systempfad ausführbar). Andernfalls meldet das System beim Klick auf "Rechnungs-PDF generieren" einen Systemfehler.
*   **Docker-Produktions-Modus (Variante B):** Full zero-config. Java und die passenden Bibliotheken sind im Docker-Image bereits fertig deployt und erfordern keinerlei manuelle Einrichtung.

---

## 6. Qualitatives Validierungs- und Testprotokoll

Um die dauerhafte Stabilität und Konformität zu verifizieren, wird eine automatisierte Test-Pipeline deklariert:

1.  **veraPDF-Prüfung:** Der veraPDF-Schnittstellen-Validator wird zur automatischen Kontrolle im CI-Build einmalig über die Ausgabedatei gejagt:
    ```bash
    java -jar mustang-cli.jar --action validate --source /path/to/invoice.pdf
    ```
    Mustangproject besitzt einen **integrierten E-Invoice / PDF/A Validator**. Das bedeutet, wir können über das CLI direkt die Validität prüfen und im Test-Log persistieren.
2.  **Umsatzsteuer-Prüfung:** Automatisierte Konsistenzprüfung, dass die mathematische Summe der Zeilennettoposten mit dem Steuergitter (`ram:ApplicableTradeTax`) und den Netto-/Bruttowerten des Headers (`GrandTotalAmount`, `DuePayableAmount`) exakt cent-genau und ohne Rundungsdifferenzen (Rundungsverfahren `roundFiscal` gemäß `AI_CONTEXT.md` Ziffer 6) übereinstimmt.

---

*Plan freigegeben zur direkten Integration. Konzipiert nach höchsten Architektur-Vorgaben für eine zukunftssichere, fehlerfreie und gesetzeskonforme Abrechnungsplattform.*
