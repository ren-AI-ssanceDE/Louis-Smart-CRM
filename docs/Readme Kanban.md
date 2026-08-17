# 📋 Kanban-Boards

> Kanban-Boards sind **digitale Aufgabenwände** — Sie verschieben Karten per Drag & Drop von „Offen“ nach „Erledigt“. Ideal für Vertriebspipelines, Projektarbeit und To-Do-Listen. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist ein Kanban-Board?

Stellen Sie sich eine **Pinnwand mit Spalten** vor: links „Offen“, in der Mitte „In Bearbeitung“, rechts „Erledigt“. Jede Aufgabe ist eine **Karte**, die Sie mit der Maus (oder am Touchscreen) von Spalte zu Spalte schieben.

Louis Smart CRM legt beim Erstellen eines Boards automatisch vier Standard-Spalten an:
**Backlog → Zu erledigen → In Bearbeitung → Erledigt**

Sie können aber eigene Spalten definieren (z. B. „Angebot versendet“, „Vertrag unterschrieben“).

## Was können Sie tun?

* **Boards anlegen** — z. B. „Vertrieb 2026“, „Tägliche Todos“, „Projekt Website-Rel launch“
* **Karten erstellen & beschreiben** — Titel, Beschreibung, Fälligkeit, Zuständigkeit
* **Karten verschieben** — per Drag & Drop; der Status wird automatisch aus der Spalte abgeleitet
* **Karten bearbeiten & löschen**
* **Genehmigungen** — Karten können einen Freigabe-Schritt durchlaufen (z. B. „Angebot muss vom Chef freigegeben werden“)

## So arbeitet Louis für Sie

* *„Lege ein Kanban-Board ‚ToDo Liste‘ mit den Spalten Offen / In Arbeit / Erledigt an.“*
* *„Erstelle auf dem Board ‚Sales‘ eine Karte ‚Follow-up Acme AG‘.“*
* *„Verschiebe die Karte ‚Rechnung 1042 prüfen‘ in ‚Erledigt‘.“*

Alles, was Louis verändert, wird Ihnen vorher als **Entwurf zur Freigabe** vorgelegt — Sie behalten die Kontrolle.

## Automatisierung

Kanban-Aktivitäten können **Workflows auslösen** — z. B.: Sobald eine Karte in „Erledigt“ verschoben wird, wird automatisch eine Notiz im CRM erstellt. Siehe [Readme Workflow-Trigger](Readme%20Workflow-Triggers.md).

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Datenmodell

| Tabelle | Inhalt |
|---|---|
| `kanban_boards` | Boards (Titel, Beschreibung, Standard-Spalten) |
| `kanban_columns` | Spalten mit `position` und `color_accent` |
| `kanban_cards` | Karten mit Titel, Beschreibung, Fälligkeit, Zuweisung |
| `kanban_approvals` | Genehmigungs-Workflows auf Karten |

**Standard-Spalten** (beim Anlegen ohne eigene Definition): `Backlog` → `Zu erledigen` → `In Bearbeitung` → `Erledigt`.

**Status-Ableitung** (`deriveKanbanStatus`): Der Kartenstatus wird aus Spaltentitel/-position abgeleitet (`backlog`, `todo`, `in_progress`, `done`, `blocked`, `archived`) — inkl. deutscher/englischer Spaltennamen.

## 2. Benutzeroberfläche (`src/pages/Kanban.tsx`)

* **Drag & Drop**: Karten per @dnd-kit zwischen Spalten verschieben (`move_kanban_card` / `kanban.card_moved`-Event).
* **Board-Verwaltung**: Boards anlegen, Spalten definieren, Karten erstellen/bearbeiten/löschen.
* **Freigaben**: Karten können Genehmigungs-Workflows durchlaufen (`kanban.approval_approved` / `kanban.approval_rejected`).
* **i18n**: Komplett zweisprachig (DE/EN).

## 3. KI-Integration

Der Tool-Katalog (Domäne `KANBAN`) umfasst:

| Tool | Funktion |
|---|---|
| `list_kanban_boards` | Boards auflisten |
| `get_kanban_board_details` | Board-Details (Spalten, Karten) |
| `create_kanban_board` | Board anlegen (Spalten + optionale Beispielkarten) |
| `create_kanban_card` | Karte erstellen |
| `update_kanban_card` | Karte aktualisieren |
| `move_kanban_card` | Karte verschieben |
| `delete_kanban_card` | Karte löschen |

**Beispiele**:
* „Lege ein Kanban-Board ‚ToDo Liste‘ mit den Spalten Offen / In Arbeit / Erledigt an“
* „Erstelle auf dem Board ‚Sales‘ eine Karte ‚Follow-up Acme AG‘“
* „Verschiebe die Karte ‚Rechnung 1042 prüfen‘ in ‚Erledigt‘“

> **Governance:** Schreibende Kanban-Aktionen laufen als Freigabe-Entwürfe (`proposedChanges`) — Konsistenz mit dem einheitlichen Draft-Flow.

## 4. Workflow-Anbindung

* **Events**: `kanban.board_created`, `kanban.card_created`, `kanban.card_updated`, `kanban.card_moved`, `kanban.card_deleted`, `kanban.column_created`, `kanban.approval_approved`, `kanban.approval_rejected` → als Workflow-Trigger nutzbar (z. B. bei Karten-Bewegung in „Erledigt“ eine Notiz schreiben).
* **DAG-Knoten**: `create_kanban_card`, `move_kanban_card`, `update_kanban_card`, `delete_kanban_card` sind als Workflow-Schritte im DAG-Picker verfügbar.
