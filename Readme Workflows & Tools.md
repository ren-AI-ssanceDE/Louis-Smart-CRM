# ⚙️ Wiki: Workflows & Tool-Integration

Die Flexibilität von **Louis Smart CRM** resultiert aus der sequentiellen Ausführung von vordefinierten Workflows und dynamischen Modul-Schnittstellen (Tools). Das System erlaubt es Benutzern, Prozesse zu automatisieren und der KI gezielte Handlungsmuster an die Hand zu geben.

---

## 🏗️ 1. Der ReAct Agent-Loop & Tools

Wenn ein Benutzer mit Louis AI interagiert, agiert das LLM nicht als statischer Antwort-Generator, sondern läuft in einem **ReAct-Modus (Reasoning + Acting)**. Hierbei entscheidet die KI anhand der Benutzeranweisung, welche System-Tools gestartet werden müssen.

### Die im Backend registrierten Tools:
1. **`local_knowledge` (RAG)**: Durchsucht Dokumentationsdateien, rechtliche Rahmenbedingungen und Benutzerhandbücher nach passenden Abschnitten.
2. **`crm_data_analyst`**: Führt strukturierte DB-Abfragen durch. Kann Umsätze aggregieren, offene Posten berechnen oder Kundenstämme filtern.
3. **`web_search`**: Nutzt das Google Web Search API-Modul (falls konfiguriert), um externe Marktberichte, Steuernormen oder Adressrecherchen in Echtzeit in den Kontext des Agenten zu laden.
4. **`create_draft_invoice`**: Erzeugt einen Rechnungs-Entwurf direkt im System basierend auf den vom Agenten extrahierten Kunden- und Positionsdaten.
5. **`send_smtp_email`**: Bereitet den SMTP-Mail-Draft vor und legt ihn dem menschlichen Benutzer im Freigabe-Layer vor.

---

## 📋 2. Custom Workflows (Arbeitsabläufe)

Benutzer können im Admin-Bereich (`src/components/admin/LouisAiWorkflowsTab.tsx`) eigene, wiederholbare Workflows anlegen. Ein Workflow ist eine logische Abfolge von Instruktionen und gekoppelten Tools.

### Typische Workflow-Szenarien:
* **Workflow: "Neukunden-Onboarding"**:
  1. Lege einen Firmenentwurf an.
  2. Generiere ein persönliches Anschreiben mit der Tonalität "professionell".
  3. Erzeuge eine Musterrechnung (z.B. Einrichtungsgebühr) mit dem Zahlungsziel des Kunden.
* **Workflow: "Mahnwesen bei Zahlungsverzug"**:
  1. Filter alle Rechnungen mit dem Status `overdue`.
  2. Erstelle für jeden säumigen Kunden eine Zahlungserinnerung auf Basis der Vorlage "Mahnung_Stufe_1".
  3. Bereite den E-Mail-Entwurf zum SMTP-Versand vor.

---

## 💾 3. Ausführung und Protokollierung

Jeder Workflow-Schritt wird vom **Louis Workflows Engine** im Backend interpretiert:
* **Status-Verfolgung**: Schritte haben die Zustände `PENDING`, `RUNNING`, `SUCCESS` oder `FAILED`.
* **Fehler-Resilienz**: Schlägt ein Teilschritt fehl (z.B. weil dem Kunden keine E-Mail-Adresse hinterlegt ist), stoppt der Workflow geordnet. Der Benutzer erhält eine klare Korrekturaufforderung auf dem Bildschirm, und ein Fehlerprotokoll wird im Audit-Log vermerkt.
* **Prozess-Transparenz**: In der Workflow-Übersicht sehen Entwickler und Anwender genau, welche System-Tools mit welchen Parametern ausgeführt wurden.
