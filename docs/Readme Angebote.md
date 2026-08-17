# 📄 Angebotsverwaltung (Offers)

> Mit dem Angebotsmodul erstellen Sie **Angebote für Ihre Kunden** — professionell als PDF, mit KI-Unterstützung und nahtloser Überleitung zur Rechnung. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist ein Angebot im System?

Ein Angebot ist ein **offizielles, formatiertes Dokument**, in dem Sie einem Kunden Ihre Leistungen und Preise unterbreiten — mit Gültigkeitsdatum, Zahlungsbedingungen und Ihrer Firmenidentität (Logo, Bankdaten).

## Was können Sie tun?

* **Angebote erstellen** — mit Positionen (z. B. „10 Stunden Beratung à 150 €“), Menge, Preisen. Das System berechnet Netto, MwSt und Brutto automatisch.
* **PDF erzeugen** — per Klick entsteht ein professionelles Angebot als PDF-Datei zum Versenden.
* **Vorlagen nutzen** — Standard-Angebotsvorlagen können importiert und angepasst werden, damit alle Angebote einheitlich aussehen.
* **Zu Rechnung machen** — finalisierte Angebote lassen sich direkt in eine Rechnung überführen (keine doppelte Dateneingabe).

## So arbeitet Louis für Sie

* *„Erstelle ein Angebot für die Acme AG über 10 Stunden Beratung à 150 €, gültig bis Ende des Monats.“* → Louis erstellt den **Entwurf**, Sie prüfen und geben frei.
* *„Verlängere die Gültigkeit des Angebots ANG-2026-0012 um zwei Wochen.“* → Update als Entwurf.
* *„Finalisiere das Angebot für die Müller GmbH und erzeuge das PDF.“* → mit Ihrer Freigabe.

## Automatisierung

Das System kann Sie automatisch an **ablaufende Angebote** erinnern: Mit dem Workflow „Angebot nachfassen“ wird z. B. ein Erinnerungs-Entwurf erstellt, wenn ein Angebot kurz vor Ablauf steht — Sie müssen nur noch freigeben.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Funktionen im Überblick

| Funktion | tRPC-Prozedur (`offersRouter`) |
|---|---|
| Angebote auflisten / Detail | `getOffers` / `getOfferById` |
| Angebot erstellen / ändern / löschen | `createOffer` / `updateOffer` / `deleteOffer` |
| PDF generieren | `generateOfferPdf` |
| Angebots-Vorlagen | `getTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `importOfferTemplates` |
| KI-Integration | Tool `create_offer_draft`, `update_offer_draft`, `finalize_and_send_offer` |

### Kernfelder
* **Identifikation**: `offer_number` (Nummernkreis mit eigenem Präfix, z. B. `ANG-2026-…`, automatische Fortschreibung), `title`, `description`
* **Gültigkeit**: `valid_until` (Gültigkeitsdatum), `payment_term`
* **Positionen**: `line_items_json` (wie Rechnungen) mit automatischer Netto/Brutto-Berechnung
* **Status**: Draft → finalisiert; optional Versand (`offer.sent`)
* **Konvertierung**: Finalisierte Angebote können in Rechnungen überführt werden

## 2. Angebots-PDF & Vorlagen

* `generateOfferPdf` erzeugt ein professionelles Angebots-PDF (pdf-lib) mit Logo und Firmendaten des eigenen Unternehmens.
* **Vorlagen-Import**: Standard-Angebotsvorlagen können importiert (`importOfferTemplates`) und angepasst werden.
* **Text- & Artikelvorlagen** werden auch im Angebotskontext genutzt (siehe [Readme Vorlagen](Readme%20Vorlagen.md)).

## 3. KI-Unterstützung

* **Erstellung**: „Erstelle ein Angebot für die Acme AG über 10 Stunden Beratung à 150 €“ → `create_offer_draft` (Freigabe-Entwurf, kein direkter Write).
* **Aktualisierung**: `update_offer_draft` (Partial-Update, z. B. `valid_until`, `payment_term`, Titel).
* **Finalisierung & Versand**: `finalize_and_send_offer` finalisiert das Angebot und erzeugt das PDF — als Freigabeaktion.
* **Analyse**: `crm_data_analyst` kann Angebotsdaten aggregieren (z. B. „Welche Angebote laufen diese Woche aus?“).

## 4. Workflow-Anbindung

* **Events**: `offer.created`, `offer.finalized`, `offer.sent`, `offer.status_updated` → Workflow-Trigger (z. B. „Angebot nachfassen“-Vorlage: automatische Erinnerung, wenn ein Angebot kurz vor Ablauf ist).
* **Vorlagen-Bibliothek**: Die 1-Klick-Starter enthalten `Angebot nachfassen` als Standard-Workflow.
