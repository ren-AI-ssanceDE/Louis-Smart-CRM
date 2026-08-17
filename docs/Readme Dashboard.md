# 📊 Controlling Dashboard & Widget-Architektur

> Das Dashboard ist die **Startseite** von Louis Smart CRM — hier sehen Sie auf einen Blick, wie es Ihrem Unternehmen geht. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist das Dashboard?

Das Dashboard ist Ihre **digitale Kommandozentrale**. Sobald Sie sich anmelden, sehen Sie die wichtigsten Kennzahlen Ihres Unternehmens auf einer übersichtlichen Seite — ohne dass Sie irgendwo suchen müssen.

## Was sehen Sie auf dem Dashboard?

```
┌────────────────────────────────────────────────────────────────┐
│  Guten Morgen, [Name] — hier ist Ihre Übersicht                │
├──────────────────────────────────┬─────────────────────────────┤
│  💰 OFFENE RECHNUNGEN            │  ✅ FREIGABEN                │
│  ─ Umsatz-Chart (letzte Monate)  │  ─ Louis-Vorschläge, die    │
│  ─ Fälligkeits-Radar             │    auf Ihre Bestätigung     │
│  ─ Summe offener Beträge         │    warten (z. B. neuer      │
│                                  │    Kontakt, Rechnungs-      │
│                                  │    entwurf)                 │
├──────────────────────────────────┴─────────────────────────────┤
│  🖥️ SYSTEM-STATUS                                               │
│  ─ Läuft die Datenbank? Läuft der E-Mail-Server?               │
│  ─ Die letzten Sicherheits-Ereignisse (Audit-Log)              │
└────────────────────────────────────────────────────────────────┘
```

### Die drei Karten im Detail

1. **💰 Offene Rechnungen** — zeigt den Umsatz der letzten Monate als Diagramm, eine Übersicht Ihrer Rechnungen nach Status (bezahlt / offen / überfällig) und die Gesamtsumme aller offenen Beträge. Ideal für die Liquiditätsplanung.

2. **✅ Freigaben** — hier landen alle Vorschläge, die der KI-Assistent Louis vorbereitet hat (z. B. ein neuer Kundenkontakt oder ein Rechnungsentwurf). Sie können jeden Vorschlag mit einem Klick **annehmen oder ablehnen** — Louis kann ohne Sie nichts speichern.

3. **🖥️ System-Status** — zeigt Ihnen, ob alles technisch in Ordnung ist: Datenbank verbunden? E-Mail-Server erreichbar? Dazu die letzten Einträge im Sicherheitsprotokoll.

## Tipps für den Alltag

* **Täglich reinschauen:** Die „Offene Rechnungen“-Karte zeigt sofort, wo Geld aussteht.
* **Freigaben nicht liegen lassen:** Alles, was Louis vorschlägt, wartet auf Ihre Entscheidung — je schneller Sie freigeben oder ablehnen, desto flüssiger läuft Ihre Arbeit.
* **Status-Karte im Blick behalten:** Wenn etwas nicht stimmt (z. B. E-Mail-Server nicht erreichbar), sehen Sie es hier zuerst.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Struktur (Bento-Grid Layout)

Das Dashboard (`src/pages/Dashboard.tsx`) nutzt ein responsives Grid-Layout mit spezialisierten Widgets:

```
┌────────────────────────────────────────────────────────────────────────┐
│  A. HEADER: Begrüßung, Mandanten-Status, Schnellauswahl                │
├──────────────────────────────────────┬─────────────────────────────────┤
│  B. OPEN INVOICES CARD               │  C. APPROVALS CARD              │
│  (Umsatz-Charts, Fälligkeiten-Radar) │  (Ausstehende AI-Entwürfe)      │
├──────────────────────────────────────┴─────────────────────────────────┤
│  D. SYSTEM STATUS CARD (DB-Modus, SMTP-Status, Audit-Vorschau)         │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. Widgets & Kennzahlen

### A. OpenInvoicesCard (`src/components/dashboard/OpenInvoicesCard.tsx`)
* **Umsatz-Uhr**: Interaktives Liniendiagramm (Recharts/D3) der gebuchten Umsätze der letzten Monate.
* **Fälligkeits-Radar**: Kreisdiagramm der Rechnungen nach Status — *Bezahlt*, *Offen (im Zahlungsziel)*, *Mahnstufe/überfällig*.
* **Umsatz-Summe**: Gesamtsumme aller unbezahlten Rechnungen (Liquiditätscontrolling).

### B. PendingApprovalsCard (`src/components/dashboard/PendingApprovalsCard.tsx`)
* **Echtzeit-Liste**: Alle von Louis AI vorgeschlagenen Änderungen (`proposedChanges`), die noch nicht freigegeben wurden.
* **Schnellaktionen**: Entwürfe direkt in der Karte ansehen und per Klick freigeben oder verwerfen (Human-in-the-Loop).

### C. SystemStatusCard (`src/components/dashboard/SystemStatusCard.tsx`)
* **Datenbank-Zustand**: PostgreSQL (Produktion) vs. lokaler Fallback-Modus.
* **SMTP-Schnittstelle**: Status des konfigurierten Mailservers (*Bereit / Fehler*).
* **Audit-Vorschau**: Die letzten Audit-Log-Einträge für sofortige Systemübersicht.

## 3. Design & Responsive-Verhalten

* **Farbkodierung** (Status): 🟢 `emerald` = aktiv/erfolgreich · 🟡 `amber` = schwebend/im Zahlungsziel · 🔴 `rose` = Fehler/kritisch/Mahnstufe
* **Fluid Layout**: Widgets dehnen sich auf breiten Bildschirmen aus; auf Tablets/Mobil stapeln sie über Tailwind-Responsive-Klassen (`grid-cols-1 lg:grid-cols-3`).
* **Interaktion**: Klickbare Kacheln reagieren mit dezentem Hover-Scale (`hover:scale-[1.01] transition-all`).
* **i18n**: Alle UI-Texte zweisprachig (DE/EN).

## 4. Datenfluss

* Kennzahlen kommen aus den tRPC-Routern (Invoices, Settings, Audit-Logs) und werden über TanStack React Query gecacht.
* Änderungen am Freigabe-Status der `proposedChanges` werden nach Aktion sofort reflektiert (Invalidierung der Query).
* Der Systemstatus aggregiert `getSystemStatus` (DB-Modus, SMTP-Test, Audit-Vorschau).
