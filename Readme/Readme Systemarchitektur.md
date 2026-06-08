# 🏗️ Wiki: Systemarchitektur & Datenfluss

**Louis Smart CRM** wurde nach dem Paradigma einer hochperformanten, typsicheren und KI-zentrierten Fullstack-Anwendung entworfen. Dieses Dokument beschreibt die strukturellen Schichten, die Interaktionen zwischen Backend und Frontend sowie die Absicherung geschäftskritischer Prozesse.

---

## 🗺️ 1. Architektur-Übersicht (Schichtenmodell)

Die Software gliedert sich in drei fundamentale Schatullensegmente:

```
  ┌─────────────────────────────────────────────────────────────────┐
  │ 1. PRÄSENTATIONSSCHICHT (Client: React 18, Tailwind, Recharts)  │
  └────────────────────────────────┬────────────────────────────────┘
                                   │
                                   ▼ (Typsichere API-Requests via tRPC)
  ┌─────────────────────────────────────────────────────────────────┐
  │ 2. LOGIKSCHICHT (Server: Express + tRPC API-Router)             │
  └────────────────┬───────────────────────────────┬────────────────┘
                   │                               │
                   ▼                               ▼
  ┌─────────────────────────────────┐   ┌───────────────────────────┐
  │ 2a. LOUIS AI ENGINE             │   │ 2b. CORE-LOGIK / RECHNUNG │
  │ (Orchestrator, Tools, Critic)   │   │ (zugferd.ts, pdfHelper)   │
  └────────────────┬────────────────┘   └──────────┬────────────────┘
                   │                               │
                   └───────────────┬───────────────┘
                                   ▼ (Transaktionen & Datenhaltung)
  ┌─────────────────────────────────────────────────────────────────┐
  │ 3. DATENSCHICHT (PostgreSQL + pgvector / Local JSON Fallback)   │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 📡 2. Typsicheres Kommunikations-Protokoll (tRPC)

Im Gegensatz zu klassischen REST-APIs, bei denen Endpunkte lose definiert und anfällig für Typen-Veränderungen sind, nutzt diese Anwendung **tRPC** zur vollkommenen Typensynchronisation zwischen Client und Server:

* **Zod-Schemata als Vertrag**: Jede tRPC-Query oder Mutation ist durch ein Zod-Schema gesichert (siehe `/src/lib/schemas.ts`).
* **Kompilierzeitprüfung**: Ändert sich ein Feldtyp im Backend-Router, meldet der TypeScript-Compiler im Frontend sofort einen Fehler. Es gibt keine unentdeckten API-Diskrepanzen zur Laufzeit mehr.
* **Kein API-Key-Leakage**: Das Frontend fragt niemals direkt externe APIs (wie Gemini oder Mail-Hoster) an. Der gesamte Request-Verkehr wird über tRPC im Backend ausgeführt, wodurch API-Keys sicher auf dem Server verbleiben.

---

## 🤖 3. Der Louis AI Orchestrator & Critic Loop

Die Integration künstlicher Intelligenz ist nicht bloß ein einfaches API-Wrapper-Skript, sondern ein autonomer Entscheidungs-Kreislauf:

1. **Intelligenz-Eingang**: Ein Freittext-Prompt des Benutzers trifft auf den tRPC-Endpoint von `/src/server/routers/louisAi.ts`.
2. **ReAct Orchestrator**: In `orchestrator.ts` steuert ein ReAct (Reasoning and Acting) Algorithmus das Modell. Es entscheidet autonom, ob und welche Werkzeuge (*Tools*) aufgerufen werden müssen.
3. **Datenzugriff & RAG**: Über die dedizierten CRM- und Knowledge-Tools (in `/src/server/ai/tools/`) sucht die KI in der PostgreSQL- oder lokalen Datenbank.
4. **The QA Critic Checking (`critic.ts`)**: Bevor Ergebnisse in die Pipeline überführt werden, läuft eine strikte, programmgestützte Plausibilitätsprüfung (Audit). Sie validiert Steuern, Formate sowie geschäftliche Logik (z.B. ob der Rechnungszahlungs-Empfänger mit der IBAN des Ausstellers übereinstimmt).
5. **Human Approval**: Kritische Aktionen (E-Mail senden, Rechnung buchen) werden nicht direkt ausgeführt, sondern als Vorschlag im Store (`proposedChanges`) persistiert.

---

## 💾 4. Duales Speicherkonzept (DB Fallback Resilienz)

Um eine unkomplizierte Entwicklung zu ermöglichen und gleichzeitig Stabilität im Offline-Modus zu gewährleisten, implementiert das System in `src/server/db.ts` einen dualen Speicher-Layer:

```typescript
export let pool: Pool | null = null;
export let isUsingFallback = false;
```

* **PostgreSQL Pfad**: Bei hergestellter Verbindung nutzt der Server einen gepoolten SQL-Zugriff. Komplexe Suchen nutzen geometrische Indizierungen über `pgvector`.
* **JSON Fallback Pfad**: Schlägt die DB-Verbindung fehl, initialisiert das System ein verschlüsseltes In-Memory Spechersystem, das kontinuierlich und atomar in die Datei `.local_fallback_db.json` schreibt.
* **Transparente API**: Die Backend-Router rufen generische Helper-Funktionen auf. Die Selektion ("Lese aus SQL" vs. "Lese aus JSON") erfolgt komplett geräuschlos im Hintergrund.
