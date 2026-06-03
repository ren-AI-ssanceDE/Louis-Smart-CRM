# 🛠️ Wiki: Tech-Stack & Entwicklungs-Richtlinien

Dieses Dokument enthält eine präzise Übersicht des gesamten Technologie-Stacks von **Louis Smart CRM** sowie die Codierungs-Kollaborationsregeln für Entwickler und CI/CD-Pipelines.

---

## 💻 1. Der Frontend-Stack (Client)

Das Frontend basiert auf einer modernen Single-Page-Application (SPA) Architektur:

* **Haupt-Framework**: **React 18** (unter Nutzung funktionaler Komponenten und moderner Hooks wie `useEffect`, `useMemo` und `useCallback`).
* **Kompilier- & Build-System**: **Vite**. HMR (Hot Module Replacement) sorgt für ein schnelles Entwicklerfeedback.
* **Typisierung**: **TypeScript 5.x** im strikten Modus (`strict: true` in `tsconfig.json`).
* **Styling**: **Tailwind CSS**. Erlaubt ein hochmütiges, konsistentes, responsives und barrierefreies Design direkt über Utility-Klassen. Bestimmungen laut `src/index.css`:
  * Hauptschriftart für UI-Texte: **Inter** (sans-serif)
  * Schriftart für Daten und Codezeilen: **JetBrains Mono** (mono-space)
* **Animationen**: **Framer Motion** (bzw. `motion` aus `motion/react`). Erlaubt flüssige View-Übergänge und responsive Dialog-Zustände.
* **Datenvisualisierung**: **Recharts** & **D3.js** für interaktive Finanz- und Umsatz-Diagramme in Echtzeit.

---

## ⚙️ 2. Der Backend-Stack (Server)

Das Backend ist als schlanke, zustandslose Express-Anwendung mit typsicheren Endpunkten konzipiert:

* **HTTP-Server**: **Express v4+**.
* **API-Standard**: **tRPC (TypeScript Remote Procedure Call)**. Keine manuellen Serialisierungsdatenströme; die Typen der Router (`src/server/routers/`) stehen dem React-Client direkt zur Verfügung.
* **KI-Schnittstelle**: **@google/genai (Modernes Node.js SDK)**. Anbindung an Googles Gemini-Modelle (Gemini 2.5/3.5) für Klassifikationen, RAG und strukturierte Objekterzeugung.
* **E-Rechnungsgenerator**:
  * **pdf-lib**: Zur Erzeugung hochpräziser PDF-Dokumente im Speicher.
  * **Mustangproject CLI (Java-Modul)**: Für die EN 16931-konforme XMP-ZUGFeRD Metadaten-Verschmelzung.
* **E-Mail Übertragung**: **Nodemailer** mit TLS und SMTP-Verbindungspooling.

---

## 🗄️ 3. Datenbank & Persistenz

* **Produktivdatenbank**: **PostgreSQL (v14+)**.
  * Erweiterung **`pgvector`** aktiviert zur performanten Speicherung von hochdimensionalen KI-Fließkommaberechnungen (Vektor-Modell Embeddings, z.B. 768 / 1536 Dimensionen) und Ähnlichkeitssuche (`<=>` Operator).
* **Entwicklung/Test-Schnittstelle**: **Local Fallback JSON File System** (`.local_fallback_db.json`). Ein lokales Datenbanksimulationssystem, das die gesamte Zod-Datenbank-Typisierung ohne externe Docker-Abhängigkeiten in Echtzeit abbilden kann.

---

## 📐 4. Programmier-Richtlinien (Codierungsregeln)

Um die Wartbarkeit der Codebase zu sichern, gelten folgende Entwicklergesetze:

### A. TypeScript: Vermeidung von `any`
Datensätze an den Schnittstellen (API und Client) müssen über Zod-Schemata validiert und typisiert sein. Die Verwendung von `any` ist bis auf wenige Systemhydrationsebenen verboten. Nutzen Sie stattdessen `unknown` in Verbindung mit Type-Guards oder deklarieren Sie abgeleitete Typen:
```typescript
type SecureInvoice = Omit<Invoice, 'id_uuid'> & { id_uuid: string };
```

### B. Standard-Enums statt Const-Enums
Im gesamten System müssen klassische TypeScript-Enums deklariert werden:
```typescript
// Richtig:
export enum PaymentStatus {
  PAID = 'paid',
  PENDING = 'pending',
  DRAFT = 'draft',
}

// Falsch (kann zu Kompilierungsfehlern im Node-ESM führen):
export const enum PaymentStatus { ... }
```

### C. Keine direkten API-Keys im Client
Einbindung von externen Schnittstellen darf ausschließlich über den Server-Router erfolgen. API-Keys im Client-Code (`src/` ohne tRPC Router-Schutz) führen im Linter zum sofortigen Build-Abbruch.
