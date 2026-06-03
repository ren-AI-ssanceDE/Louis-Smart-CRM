# 📊 Wiki: Controlling Dashboard & Widget-Architektur

Das Dashboard (`src/pages/Dashboard.tsx`) ist die visuelle und analytische Kommandozentrale von **Louis Smart CRM**. Es aggregiert in Echtzeit die wichtigsten Kennzahlen (KPIs) des Unternehmens, zeigt offene Forderungen und listet fällige Genehmigungen.

---

## 🏗️ 1. Struktur des Dashboards (Bento-Grid Layout)

Das Dashboard nutzt ein modernes, responsives und hochauflösendes Grid-Layout, das sich an alle Bildschirmgrößen anpasst. Es setzt sich aus folgenden spezialisierten Widgets zusammen:

```
┌────────────────────────────────────────────────────────────────────────┐
│  A. HEADER: Begrüßung, Mandanten-Status, Schnellauswahl                │
├──────────────────────────────────────┬─────────────────────────────────┤
│                                      │                                 │
│  B. WIDGET: OPEN INVOICES CARD       │  C. WIDGET: APPROVALS CARD      │
│  (Umsatz-Charts, Fälligkeiten-Radar) │  (Ausstehende AI-Entwürfe)      │
│                                      │                                 │
├──────────────────────────────────────┴─────────────────────────────────┤
│                                                                        │
│  D. WIDGET: SYSTEM STATUS CARD (DB-Modus, SMTP-Status, Audit-Logs)     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 2. Widget-Details & Kennzahlen

### A. OpenInvoicesCard (`src/components/dashboard/OpenInvoicesCard.tsx`)
Dieses Widget konzentriert sich auf die Liquidität und das Belegwesen:
* **Umsatz-Uhr**: Ein interaktives Liniendiagramm (Recharts/D3), das die gebuchten Umsatzerlöse über die letzten Monate visualisiert.
* **Fälligkeits-Radar**: Ein Kreisdiagramm, das Rechnungen nach Fälligkeit einteilt (z.B. *Bezahlt*, *Offen (im Zahlungsziel)*, *Mahnstufe 1 (überfällig)*).
* **Umsatz-Summe**: Zeigt die Gesamtsumme aller unbezahlten Rechnungen an, um das Liquiditätscontrolling zu erleichtern.

### B. PendingApprovalsCard (`src/components/dashboard/PendingApprovalsCard.tsx`)
Die Kontrollstelle für die Zusammenarbeit zwischen Mensch und KI:
* **Echtzeit-Liste**: Listet alle im Hintergrund von Louis AI vorgeschlagenen Änderungen (`proposedChanges`), die noch nicht freigegeben wurden.
* **Schnellaktionen**: Der Anwender kann Rechnungsentwürfe direkt in der Karte ansehen und sie mit einem Klick in der Datenbank abspeichern oder verwerfen.

### C. SystemStatusCard (`src/components/dashboard/SystemStatusCard.tsx`)
Gibt direkte Rückmeldung über den technischen Gesundheitszustand der CRM-Infrastruktur:
* **Datenbank-Zustand**: Statusanzeige, ob das System mit einer echten PostgreSQL-Datenbank (Produktion) läuft oder im sicheren lokalen Offline-Fallback-Modus (`.local_fallback_db.json`) arbeitet.
* **SMTP-Schnittstelle**: Status des konfigurierten SMTP-Mailservers (*"Bereit / Fehler"*).
* **Audit-Vorschau**: Die letzten drei aufgezeichneten Audit-Log-Einträge für eine sofortige Übersicht der jüngsten Systemaktivitäten.

---

## 🎨 3. UI-Design, Kontraste & Responsive Prefixes

Um eine exzellente Benutzererfahrung zu bieten, wurden die Widgets nach strengen Designrichtlinien entworfen:
* **Farbkodierung**: Statusanzeigen nutzen klare Farbkontraste:
  * 🟢 **Erfolgreich/Aktiv**: `text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20`
  * 🟡 **Schwebend/Zahlungsziel**: `text-amber-600 bg-amber-50`
  * 🔴 **Fehler/Kritisch/Mahnstufe**: `text-rose-600 bg-rose-50`
* **Desktop-First Precision**: Widgets dehnen sich auf breiten Bildschirmen harmonisch aus (*Fluid Layout*), während sie auf Tablets und mobilen Endgeräten über Tailwind responsive Klassen (`grid-cols-1 lg:grid-cols-3`) sauber untereinander gestapelt werden.
* **Hover-Zustände**: Jede anklickbare Status-Kachel reagiert mit einer dezenten Vergrößerung (`hover:scale-[1.01] transition-all`) für ein lebendiges Gefühl bei der Bedienung.
