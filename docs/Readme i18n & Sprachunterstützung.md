# 🌐 i18n & Sprachunterstützung

> **Louis Smart CRM spricht Deutsch und Englisch** — die komplette Oberfläche ist zweisprachig. Dieses Dokument erklärt das Sprachsystem für Anwender und die technische Umsetzung für Entwickler. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was bedeutet „i18n“?

„i18n“ ist die Abkürzung für **Internationalisierung** — die Fähigkeit einer Software, mehrere Sprachen zu unterstützen. Louis Smart CRM ist vollständig zweisprachig:

* **Deutsch** (Standard)
* **Englisch**

## Wie wechsle ich die Sprache?

Die Sprache wird automatisch erkannt (Browsereinstellung) — Sie können sie aber auch manuell umschalten. Nach dem Wechsel erscheint die **gesamte Oberfläche** in der gewählten Sprache: Menüs, Formulare, Fehlermeldungen, Workflow-Bausteine, Dashboard — alles.

## Was ist für Sie wichtig?

* **Keine „halben“ Übersetzungen:** Das System erzwingt technisch, dass **jede** Bildschirmmeldung in beiden Sprachen existiert. Es kann also nicht passieren, dass nach einem Update plötzlich englische Textfetzen in der deutschen Oberfläche auftauchen.
* **Ihre Daten sind sprachunabhängig:** Kundennamen, Rechnungen und Notizen sind natürlich nicht „übersetzt“ — nur die Bedienoberfläche.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Technik

* **Bibliothek**: `react-i18next` / `i18next` v26 mit Browser-Language-Detector
* **Locales**: `src/i18n/locales/de.json` und `en.json` (große Namensräume: `common`, `admin`, `templates`, `workflows` …)
* **Fallback-Sprache**: Deutsch (Standard)
* **Verwendung**: `useTranslation()` → `t('key', { defaultValue: '…' })`

## 2. i18n-Pflicht (Regel 10)

* **Jede** benutzersichtbare Zeichenkette MUSS über i18n laufen — kein hartkodierter UI-Text.
* **Tool**: `scripts/extract-missing-i18n.mjs` erkennt fehlende Übersetzungen.
* **Gate**: `npm run check:rules` (pre-commit-Hook) blockiert Commits mit hartkodierten UI-Texten oder fehlenden DE/EN-Keys.
* **Server-seitige Tool-Beschreibungen** (SYSTEM_TOOL_CATALOG) sind von der i18n-Pflicht ausgenommen, da sie nicht im UI gerendert werden.

## 3. Bereiche

| Bereich | Beispiele |
|---|---|
| Navigation & Seiten | Dashboard, Unternehmen, Kontakte, Rechnungen, Angebote, Kanban, Council |
| Louis AI Studio | Chat, Thought Log, proposedChanges-Freigaben |
| Admin-Panel | Einstellungen, Workflows (DAG-Picker-Labels), Vorlagen, Agent-Jobs, MCP-Verwaltung |
| Dashboards & Status | Widget-Titel, Statusfarben, Meldungen |

## 4. QA

* `check:rules` prüft DE/EN-Konsistenz bei jedem Commit.
* E2E-Tests laufen gegen die deutsche Locale (Standard); UI-Gap-Specs decken fehlende Übersetzungen ab.
* Neue Funktionen: i18n-Keys in **beiden** Locales anlegen, sonst Gate-Fehler.
