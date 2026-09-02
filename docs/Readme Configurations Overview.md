# Admin-Panel — Alle Einstellungen im Überblick

> **Zweck:** Alle Einstellungsmöglichkeiten des Admin-Panels (inkl. aller Unterseiten) tabellarisch: Einstellungsmöglichkeit · Empfohlener Wert · leicht verständliche Erklärung (Wirkung).
> Jede Zeile ist gegen Code und Datenbank belegt (aktueller Stand). Empfehlung = Projekt-Standardwert bzw. „leer lassen (Backend-Standard)", wenn kein Wert nötig ist.
> **Legende:** ⚙️ = Systemparameter (DB-Config) · 🧩 = Verwaltung/Inhalte · 👁️ = reine Anzeige

---

## 1. Admin-Profil (`profile`, ProfileTab.tsx)

### 1a. Profil-Daten (speichert in `core_registry_my_company` — Admin-/Firmenkontakt)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Anrede | Herr / Frau / keine | Wird als Anrede in Briefen, E-Mails und Dokumenten verwendet. |
| Geschlecht | m / w / d / keine | Ermöglicht korrekte Anredeformen in Dokumenten (z. B. „Sehr geehrter Herr"). |
| Vorname | Eigenen Vornamen eintragen | Erscheint im Profilkopf und in Unterlagen als Ansprechpartner-Name. |
| Nachname | Eigenen Nachnamen eintragen | Erscheint im Profilkopf und in Unterlagen; Default „User" wird als „Admin" angezeigt. |
| E-Mail | Geschäftliche E-Mail-Adresse | Kontaktadresse des Unternehmens/Ansprechpartners für Korrespondenz. |
| Zeitzone | Europe/Berlin | Steuert die Zeitanzeige im System (Dashboard, Zeitstempel, Termine). |
| Geburtsdatum | Optional | Persönliche Angabe des Ansprechpartners; nur ausfüllen, wenn benötigt. |
| Region | Optional (z. B. Bundesland) | Regionale Zuordnung des Ansprechpartners. |
| Telefon | Geschäftliche Festnetznummer | Kontaktmöglichkeit (wird in Unterlagen übernommen). |
| Mobil | Mobilnummer | Kontaktmöglichkeit unterwegs. |

### 1b. Sicherheit & Login-Zugangsdaten (updateCredentials → `auth_access_identities`)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Login-E-Mail-Adresse | admin@louis-crm.de (bzw. eigene Adresse) | Anmeldeadresse des Administrator-Kontos; Änderung gilt ab dem nächsten Login. |
| Neues Passwort (optional) | Leer lassen = unverändert; sonst sicheres Passwort (mind. 8 Zeichen, Groß-/Kleinbuchstaben + Ziffern) | Setzt das Anmeldepasswort neu. Wird nur gehasht (PBKDF2) gespeichert — nie im Klartext. |
| Passwort bestätigen | Muss exakt dem neuen Passwort entsprechen | Verhindert Tippfehler bei der Passwortänderung. |

---

## 2. Mein Unternehmen (`my_company`, MyCompanyForm.tsx — speichert in `core_registry_my_company`)

Diese Daten erscheinen als **Absender auf Rechnungen, Angeboten und PDF-Dokumenten** und steuern die Dokumenten-Nummern.

### 2a. Firmenstamm

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Firmenname (full_legal_name) | Exakter, offizieller Firmenname | Absender auf allen Rechnungen/Angeboten; Pflicht für korrekte Dokumente. |
| Kurzbezeichnung (short_code) | Optionale Abkürzung | Kurzform des Firmennamens für interne Zwecke. |
| USt-IdNr. (tax_vat_id) | Gültige USt-IdNr. (z. B. DE123456789) | Wird auf Rechnungen ausgewiesen (B2B-Pflicht in der EU). |
| Steuernummer (tax_number) | Vom Finanzamt vergebene Nummer | Wird auf Rechnungen angegeben (v. a. B2C). |
| Verantwortliche Person | Name des Ansprechpartners | Erscheint in Dokumenten als verantwortliche Person. |
| Straße + Hausnummer | Vollständige Anschrift | Absenderadresse auf Rechnungen/Angeboten. |
| PLZ + Ort | Vollständige Anschrift | Absenderadresse auf Rechnungen/Angeboten. |
| Land (country_code) | DE (Standard) | Ländercode der Absenderadresse; Default „DE". |
| E-Mail / 2. E-Mail | Geschäftliche Adressen | Kontaktangaben des Absenders. |
| Webseite | Eigene Domain | Kontaktangabe auf Dokumenten. |
| Telefon / Mobil / Fax | Geschäftliche Nummern | Kontaktangaben des Absenders. |
| Logo (logo_url) | Bild hochladen (max. 2 MB, PNG/JPG) | Firmenlogo erscheint auf Rechnungen/Angeboten/PDFs; kein Logo = Initialen-Block. |

### 2b. Bankverbindung (Zahlungsempfänger)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| IBAN | Gültige IBAN (wird live validiert) | Bankverbindung auf Rechnungen; BIC/Bankname werden automatisch ermittelt. |
| BIC/SWIFT | Automatisch ergänzt | Bankleitzahl zur IBAN; wird bei Eingabe der IBAN selbst gefüllt. |
| Bankname | Automatisch ergänzt | Anzeigename der Bank. |
| Leitweg-ID (leitweg_id) | Bei öffentlichen Aufträgen (B2G): Leitweg-ID | Erforderlich für E-Rechnungen an öffentliche Auftraggeber (XRechnung). |

### 2c. Standardwerte für Dokumente

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Standard-Mehrwertsteuersatz (vat_rate) | 19 (DE-Standard) | Wird neuen Rechnungen/Angeboten als MwSt.-Satz vorbelegt. |
| Standardwährung (currency_code) | EUR | Währung, mit der neue Dokumente angelegt werden. |
| Sprache (language) | de | Standardsprache des Unternehmens für Dokumente. |

### 2d. Rechnungsnummern (Format: `Präfix[-Jahr]LaufendeNummer`)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Rechnungs-Präfix (invoice_number_prefix) | RE- | Anfangszeichen jeder Rechnungsnummer (z. B. RE-2026-0001). |
| Jahresbestandteil fix (invoice_number_year_fixed) | An (true) | Jahr in der Nummer: an = RE-2026-0001, aus = RE-0001. |
| Nächste laufende Nummer (invoice_number_next_seq) | Automatisch fortgeführt | Nächste freie Nummer; nur manuell ändern, wenn z. B. eine Lücke entstehen soll. |
| Mindeststellenzahl (invoice_number_min_digits) | 4 | Führt die laufende Nummer mit Nullen: 0001 statt 1. |

### 2e. Angebotsnummern (analog, Format: `Präfix[-Jahr]LaufendeNummer`)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Angebots-Präfix (offer_number_prefix) | AN- | Anfangszeichen jeder Angebotsnummer (z. B. AN-2026-0001). |
| Jahresbestandteil fix (offer_number_year_fixed) | An (true) | Jahr in der Nummer: an = AN-2026-0001, aus = AN-0001. |
| Nächste laufende Nummer (offer_number_next_seq) | Automatisch fortgeführt | Nächste freie Angebotsnummer. |
| Mindeststellenzahl (offer_number_min_digits) | 4 | Führt die laufende Nummer mit Nullen: 0001 statt 1. |

---

## 3. Benutzerverwaltung (`users`, UsersTab.tsx — verwaltet `auth_access_identities`)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Vollständiger Name (Pflicht) | Realer Name des Benutzers | Anzeigename des Kontos (Login, Logs). |
| E-Mail-Adresse (Pflicht) | Gültige E-Mail | Anmeldeadresse des Benutzers. |
| Rolle | staff (Standard), admin, system | Legt die Rechte fest: **staff** = normaler Benutzer (Zugriff auf die Anwendung/Chat), **admin** = Administrator (Zugriff auf das Admin-Panel), **system** = Systemrolle (Sonderfall, nur mit Bedacht vergeben). |
| Passwort | Bei Neuanlage Pflicht: sicheres Passwort; beim Bearbeiten leer lassen = unverändert | Anmeldepasswort des Benutzers (nur gehasht gespeichert). |

---

## 4. Systemeinstellungen (`settings`, SystemSettingsTab.tsx)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Systemsprache | Deutsch (de) — alternativ English (en) | Sprache der gesamten Benutzeroberfläche. |
| Kontakt-Spalten (Tabellenansicht) | Standard (alle Kernelemente) | Bestimmt, welche Spalten in der Kontaktliste angezeigt werden: Verantwortliche Person, Kommunikation, Firma, Adresse, Geburtsdatum. |
| Firmen-Spalten (Tabellenansicht) | Standard (alle Kernelemente) | Bestimmt, welche Spalten in der Firmenliste angezeigt werden: Verantwortliche Person, Kommunikation, Firma, Adresse, Rechnung, Angebot. |
| Bank-Verzeichnis aktualisieren | Aktuellen Stand laden (Button) | Aktualisiert das eingebaute Bankverzeichnis (DE/AT/CH) für die IBAN-/BIC-Erkennung. |
| Auf Standard zurücksetzen | Nur bei Bedarf | Setzt die Spalten-Konfiguration auf die Werkseinstellungen zurück. |

## 5. LOUIS AI Config — Unterseiten (`louis_config`, LouisAiSettingsForm.tsx / `sys_integrations_louis_ai_config`)

### 5a. 🎙️ Speech-to-Text (STT) — Unterseite „Provider & RAG" (STT-Bereich)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| STT Provider | Local Whisper (faster-whisper) — alternativ OpenAI Whisper Cloud oder Deaktiviert | Wählt die Spracherkennungs-Engine für Sprachnachrichten (lokal = datenschutzfreundlich, Cloud = mehr Rechenleistung). |
| Modellname | z. B. faster-whisper-large-v3 (lokal) / whisper-1 (Cloud) | Das Spracherkennungsmodell; größere Modelle sind genauer, aber langsamer. |
| Endpoint-URL | Lokal: http://localhost:8000/v1/audio/transcriptions | Adresse des Spracherkennungsdienstes. |
| API Key / Token (Optional) | Leer bei lokalem Whisper | Schlüssel für Cloud-Dienste; lokal nicht nötig. |
| Erkennungssprache | de (bzw. passende Sprache) | Sprache, in der die Spracherkennung arbeitet. |
| Erkennungshilfen (Prompt/Keywords) | Fachbegriffe, z. B. „Louis, CRM, Kontakt, Unternehmen, Workflow, E-Rechnung" | Begriffe, die Whisper bevorzugt erkennen soll — verbessert Fachbegriffe. |
| Recheneinheit (Device) | Automatisch (GPU, falls vorhanden) | Nutzt GPU oder CPU für die lokale Transkription. |
| Quantisierung | Automatisch | Komprimiert das Modell für weniger VRAM (Qualität/Kompromiss). |
| Unload LLM on Demand | An | Entlastet die GPU vor der Transkription (bei begrenztem VRAM). |
| Failsafe CPU Fallback | An | Weicht bei GPU-Speicherfehlern automatisch auf CPU aus — Transkription schlägt nicht fehl. |

### 5b. 🧠 KI-Provider & Modell

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Provider | Google Gemini AI (Standard) — alternativ Ollama Local, OpenAI, Anthropic | Welcher KI-Dienst die Antworten erzeugt. Lokal (Ollama) = offline/datenschutzfreundlich, Cloud = leistungsfähiger. |
| Modellname | Vom Provider empfohlenes Modell | Das verwendete KI-Modell (z. B. Gemini-Pro, llama3, GPT, Claude). |
| API-Key / Token | Eigenen Schlüssel eintragen (wird verschlüsselt gespeichert) | Zugangsschlüssel zum KI-Anbieter; bei lokalem Ollama nicht nötig. |
| Basis-URL | Ollama: http://localhost:11434 | Serveradresse des KI-Dienstes (bei Cloud-Diensten Standard-URL lassen). |
| Temperatur | 0.2 (Standard) | Kreativität der Antworten: niedrig = präzise/sachlich, hoch = kreativ/variabel. |
| Top P (Kausalität) | 0.9 | Steuert die Wortauswahl-Vielfalt; niedriger = fokussierter. |
| Top K (Token-Einstufung) | 40 | Begrenzt die Kandidatenauswahl pro Schritt. |
| Kontext-Sitzungsfenster (num_ctx) | 8192 (oder mehr bei großem Kontext) | Wie viel Kontext das Modell pro Anfrage verarbeiten kann (größer = teurer/langsamer). |

### 5c. 📚 RAG & Embeddings (Wissensdatenbank)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Vektor-Embedder Provider | Gemini (Standard) — alternativ Ollama Local, OpenAI | Erzeugt Vektordarstellungen für die Wissensdatenbank (Ähnlichkeitssuche). |
| Vektor-Modellname | z. B. text-embedding-004 / nomic-embed-text | Das Embedding-Modell; muss zum Provider passen. |
| Embedding Server Basis-URL | z. B. http://localhost:11434 | Adresse des Embedding-Dienstes. |
| Embedding API Key (Optional) | Leer bei lokalem Dienst | Schlüssel für Cloud-Embedding-Dienste. |
| Dokumenten-Chunkgröße (Wörter) | 500 | In wie große Stücke Dokumente für die Suche zerlegt werden. |
| Überlappungs-Menge (Wörter) | 50 | Überschneidung zwischen Chunks — hält Zusammenhänge. |
| Ollama VRAM Keep-Alive (Minuten) | 5 | Wie lange das Embedding-Modell im Speicher bleibt (schneller, aber VRAM). |
| Hardware-Parallelisierung (slots) | 1 (bei begrenztem VRAM) | Anzahl paralleler Embedding-Anfragen. |
| Vektor-Dimensionen | 1536 (passend zum Modell) | Dimension der Vektoren; muss zur Embedding-Modell-Dimension passen. |

### 5d. ⚙️ Agenten-Laufzeit (ReAct-Parameter) — leere Felder = Backend-Default

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Max. ReAct-Iterationen | Leer (automatisch, 4–6) | Maximale Anzahl Tool-Ausführungsrunden, bevor der Agent antwortet — verhindert Endlosschleifen. |
| Chat-Verlauf Token-Budget | Leer (Backend-Default) | Wie viele Tokens des Chat-Verlaufs pro Anfrage verfügbar sind; ältere Nachrichten werden komprimiert. |
| Gedächtnis-Budget (Tokens) | Leer (Backend-Default) | Token-Umfang des Gedächtnisses im Prompt. |
| Tool-Ergebnis-Limit (Zeichen) | Leer (Default 2000) | Maximale Zeichenzahl, mit der Tool-Ergebnisse in den Prompt eingebettet werden. |
| Voll eingebettete letzte Ergebnisse | Leer (Default 2) | Anzahl der neuesten Tool-Ergebnisse, die vollständig angezeigt werden; ältere werden zusammengefasst. |
| Zusammenfassung ab Iteration | Leer (Default 3) | Ab dieser Iteration werden ältere Tool-Ergebnisse kompakt zusammengefasst. |
| Early-Exit nach N Tools | Leer (Default 4) | Nach dieser Anzahl ausgeführter Tools erzwingt der Agent die Antwort — verhindert Endlosschleifen. |
| Prompt-Direktiven-Modus | Immer einfügen (bisheriges Verhalten) — alternativ „Nur bei E-Mail-Bezug" (spart Tokens) | Steuert, wann die E-Mail-/Mahnungs-Direktiven im Prompt stehen. |
| Tool-Call-Modus | Automatisch (native Tool-Calls, JSON-Fallback) | Wie der Agent Werkzeug-Aufrufe ausführt: automatisch (empfohlen), nur nativ, oder JSON-Freitext. |
| Text-Fallback-Kanal | AN (kompatibel) | Erlaubt XML-/JSON-Text-Fallback für Modelle ohne natives function calling; AUS = strikt nur strukturierte Aufrufe. |

### 5e. 🗜️ Cache-Tier & Kontext-Kompression (endlose Chats)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Parallel-Tool-Guidance | An | Fügt dem Prompt Anleitungen zum Bündeln unabhängiger Lese-Tools hinzu (effizientere Antworten). |
| Tool-Guidance-Trim | An | E-Mail-Direktiven nur einfügen, wenn E-Mail-Tools aktiv sind — spart Tokens, stabiler Prompt-Anfang. |
| Frozen Memory-Snapshot | An | Gedächtnis 1× pro Anfrage einfrieren (stabiler Cache); AUS = Live-Aktualisierung mitten im Turn. |
| Kontext-Kompression | An | Fasst alte Chat-Inhalte zusammen, damit endlose Chats im Kontextfenster bleiben. |
| Kompressions-Schwelle (% des Fensters) | Leer (Backend-Default) | Ab welcher Füllung des Kontextfensters komprimiert wird. |
| Geschützter Schwanz (Tokens) | Leer (Backend-Default) | Die letzten N Tokens bleiben immer vollständig erhalten (aktuelle Konversation). |
| Aux-Modell für Zusammenfassungen | Leer = Hauptmodell | Günstigeres Modell für Zusammenfassungs-Calls (spart Kosten). |
| Summary persistieren | An | Speichert Zusammenfassungen in der Session-DB — Rückblick bleibt möglich. |
| Modell → Kontextfenster-Map (JSON) | Leer (Standard) | Ordnet Modellen ihre Kontextfenstergröße zu (für die Kompressionsberechnung). |

### 5f. 💾 Memory (Gedächtnis & Recall)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Query-Prefetch | An | Lädt relevante Gedächtnis-Einträge pro Anfrage zuerst (bessere Antworten). |
| Recall-Status im Chat | An | Zeigt im Chat, ob Gedächtnis-Inhalte eingeflossen sind. |
| Auto-Memory-Scan | An | Prüft gespeicherte Inhalte auf Credentials/PII und blockt sie beim Speichern. |
| Prefetch-Timeout (Sekunden) | Leer (Backend-Default, ~8) | Hängende Gedächtnis-Abrufe blockieren die Antwort nie (nicht-fatal). |
| Konsolidierungs-Budget (Tokens) | Leer (Backend-Default) | Bei Überlauf werden älteste Notizen per KI zusammengefasst statt gelöscht. |

### 5g. 🛡️ Fehlerfestigkeit (Guards)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Thinking-Scrubber | An | Entfernt interne Denkprozesse aus sichtbaren Antworten. |
| Tool-Call-Retry-Max | Leer (Backend-Default) | Korrektur-Runden bei kaputten Tool-Aufrufen. |
| Empty-Response-Budget | Leer (Backend-Default) | Leere Antworten: Wiederholungsversuche bis zum Budget, dann sauberer Abbruch. |
| Empty-Streak-Kostenlimit (USD) | Leer (Backend-Default) | Teure leere Antwort-Serien brechen früher ab. |
| Guardrail: identischer Fehl-Call | Leer (Backend-Default) | Gleicher fehlgeschlagener Tool-Aufruf > N× → Hinweis ans Modell. |
| Guardrail: No-Progress | Leer (Backend-Default) | Mehrere Fehlschläge ohne Fortschritt → Strategie-Hinweis ans Modell. |
| Loop-Deadline (Sekunden) | Leer (Backend-Default) | Harte Zeitgrenze: hängende Läufe werden garantiert beendet. |

### 5h. 📜 Sessions & Recall

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| FTS-Ranking (PG-tsvector) | An | Gewichtete Suche in alten Chats (Titel > Zusammenfassung > Inhalt + neuere zuerst); AUS = immer neueste Sessions. |
| Recall-Treffer-Limit | Leer (Backend-Default) | Standard-Trefferzahl der Chat-Rückblick-Suche. |

### 5i. 📖 Skills & Curator

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Skill-Curator | An | Pflegt die Wissens-Skills automatisch (inaktiv markieren, archivieren — nie löschen). |
| Skill-Injektions-Budget (Tokens) | Leer (Backend-Default) | Maximale Token-Menge für Skill-Details im Prompt. |
| Skill-Top-K | Leer (Backend-Default) | Anzahl relevanter Skills, die pro Anfrage eingebettet werden. |
| Inaktiv nach Tagen | Leer (Backend-Default) | Ungenutzte Skills werden als „inaktiv" markiert (Reaktivierung bei Nutzung). |
| Curator-Intervall (Stunden) | Leer (Default 24h) | Wie oft der Curator läuft. |
| Archivieren nach Tagen | Leer (Backend-Default) | Inaktive Skills wandern nach N Tagen ins Archiv — niemals Löschung. |

### 5j. 🔌 MCP & Sub-Agenten

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| MCP-Refresh-Intervall (Sekunden) | Leer (Backend-Default) | Wie oft die Tool-Liste externer Anbindungen aktualisiert wird (Cache spart Datenbank-Zugriffe). |
| Sub-Agent-Deadline (Sekunden) | Leer (Backend-Default) | Zeitlimit für delegierte Teil-Aufgaben — hängende Sub-Agenten werden beendet. |
| Sub-Agenten parallel (max.) | Leer (Backend-Default) | Maximale Anzahl gleichzeitig laufender Teil-Aufgaben. |
| Sub-Agenten-Tiefe (max.) | Leer (Default 3) | Maximale Verschachtelungstiefe bei Delegationen. |
| *(Backend-Parameter: MCP-Approval-Timeout, MCP-Stack-Max-Sessions)* | Leer (Backend-Default) | Zeitlimit für Freigaben externer Tools bzw. maximale parallele Server-Sitzungen. |

### 5k. 🗄️ Aufbewahrung

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Audit-Log Aufbewahrung (Tage) | Leer = kein automatisches Löschen | Nach wie vielen Tagen alte Audit-Einträge automatisch entfernt werden (Datenschutz/DSGVO). |
| Chat-Verlauf Aufbewahrung (Tage) | Leer = kein automatisches Löschen | Nach wie vielen Tagen alte Chat-Sitzungen automatisch entfernt werden. |

## 6. Gedächtnis & Wissen (`louis_memory`, LouisAiMemoryForm.tsx)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Antwort-Präferenzen (response_preferences_text) | Freitext, z. B. „Antworte immer auf Deutsch, kompakt und mit Belegen" | Dauerhafte Vorgaben, die Louis bei jeder Antwort berücksichtigt (Stil, Sprache, Format). |
| Notizen (Benutzer / Kontakt / Firma) | Inhalte für den jeweiligen Kontext | Persönliche Notizen, die Louis im Gedächtnis hat und bei relevanten Gesprächen einbezieht. |
| Notiz „RAG-indexiert" | An | Notiz wird in die Wissensdatenbank (Vektor-Suche) aufgenommen — Louis findet sie über Ähnlichkeitssuche. |
| Wissensdateien (Upload) | Dokumente hochladen (PDF, TXT, Markdown …) | Dateien, die Louis als Wissen durchsuchen kann (Wissensdatenbank/RAG). |
| Speichern/Löschen je Eintrag | — | Verwaltung: Einträge anlegen, bearbeiten, löschen (Löschung sofort wirksam). |

## 7. LLM Council Config (`council_settings`, CouncilSettingsTab.tsx / `council_settings`)

Der Council ist eine zusätzliche KI-Instanz für besonders komplexe Entscheidungen (z. B. mehrere Rollen oder Modelle beraten gemeinsam).

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Council aktiviert | An | Schaltet den Council-Betrieb ein/aus. |
| Standard-Modus | multi-role | **multi-role** = mehrere KI-Rollen beraten; **multi-model** = mehrere Modelle beraten. |
| Standard-Max-Runden | 2 (Schema-Default, 1–5 möglich; UI-Tipp: Karpathy empfiehlt 3) | Maximale Anzahl Beratungsrunden im Council. |
| Council-Timeout (Sekunden) | Leer = Standard 120 (Bereich 15–600) | Harte Zeitgrenze für eine Council-Antwort: hängende/debattierende Runden werden nach Ablauf beendet, statt den Chat endlos warten zu lassen. Zusätzlich 1 automatischer Wiederholungsversuch im Multi-Role-Modus bei Abbruch. |
| Provider (max. 5) | Eigenen KI-Anbieter eintragen (Name, Typ, API-Key, Basis-URL, aktiv) | Welche KI-Dienste der Council nutzen kann. |
| Rollen (Debattanten) | Vordefinierte Rollen (Name/Persona, System-Prompt, Temperatur 0.7) | Rollen mit eigenen Anweisungen für die Beratung. |
| Peer-Review-Prompt | Standard (vordefiniert), Reset-Button | Anweisung für die gegenseitige Bewertung der Antworten (Phase 2). |
| Vorsitz-Prompt (Chairman) | Standard (vordefiniert), Reset-Button | Anweisung für die Zusammenfassung/Entscheidungsfindung (Phase 3). |
| *(Mitglieder-Zuordnung & Fallback-Provider/-Modell)* | Automatisch — kein eigenes Eingabefeld im Admin-Tab | Wer in der Beratung spricht und die Ausweich-KI bei Fehlern werden systemseitig aus Rollen/Providern gebildet. Die Felder existieren im Hintergrund-Schema, sind im Admin-Panel aber nicht direkt einstellbar. |

## 8. Agent-Jobs (`louis_jobs`, AgentJobsTab.tsx)

Automatische, zeitgesteuerte Aufgaben des KI-Agenten (z. B. tägliche Berichte).

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Job-Name | Eindeutiger Name, z. B. „Täglicher Überblick" | Bezeichnung des automatisierten Auftrags. |
| Job-Typ | agent (Standard) — alternativ script / monitor | **agent** = KI führt einen Auftrag aus; **script** = führt ein Skript aus; **monitor** = beobachtet und meldet. |
| Job-Prompt (bei Typ agent) | Klare Anweisung, z. B. „Fasse offene Rechnungen zusammen" | Was der Agent bei jedem Lauf tun soll. |
| Skript-Pfad (bei Typ script) | Pfad zum Skript | Welches Skript ausgeführt wird. |
| Zeitplan-Typ | täglich (empfohlen) — alternativ stündlich / wöchentlich | Wie oft der Job läuft. |
| Uhrzeit | z. B. 07:30 | Tageszeit des Laufs. |
| Wochentag (bei wöchentlich) | z. B. Montag | Wochentag des Laufs. |
| Lieferung an | session (Standard) — alternativ mail_draft / telegram | Wohin das Ergebnis geht: Chat-Sitzung, E-Mail-Entwurf oder Telegram. |
| Liefer-Ziel | Je nach Ziel (z. B. E-Mail-Adresse, Telegram-Kanal) | Empfänger des Ergebnisses. |
| Erlaubte Bereiche (allowedDomains) | Leer = alle Tools | Einschränkung, welche Tool-Bereiche der Job nutzen darf (z. B. nur CRM). |

## 9. Governance-Regeln (`louis_governance`, GovernanceRulesTab.tsx)

Regeln, die festlegen, was der KI-Agent darf — Default ohne Regel: ALLOW.

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Regelname | Klarer Name, z. B. „Angebote nur mit Freigabe" | Bezeichnung der Regel. |
| Entitätstyp | Betroffener Bereich (z. B. Angebote, Rechnungen, Kontakte) | Für welche Datenart die Regel gilt. |
| Aktion | CREATE / UPDATE / DELETE / SEND / MOVE / EXPORT / EXECUTE | Für welche Aktion die Regel gilt. |
| Effekt | BLOCK (Standard) — alternativ ASK / REQUIRE_APPROVAL / ALLOW | **BLOCK** = verhindern; **ASK** = nachfragen; **REQUIRE_APPROVAL** = Entwurf + Freigabe nötig; **ALLOW** = erlauben. |
| Notiz/Begründung | Kurzer Hinweis für den Agenten | Erklärung, die dem Agenten bei ASK angezeigt wird. |
| Aktiv/Inaktiv (Toggle) | Aktiv für wirksame Regeln | Schaltet die Regel ein/aus. |

## 10. Rückfragen (`louis_questions`, AiQuestionsTab.tsx) — 👁️ Verwaltung

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Rückfragen beantworten | Antwort im Freitextfeld | Offene Rückfragen des Agenten direkt beantworten; die Entscheidung fließt in die nächste Antwort ein. |
| Rückfrage löschen | Nur bei Bedarf | Entfernt eine Rückfrage (2-Stufen-Bestätigung). |
| Suche | Suchbegriff eingeben | Filtert die Rückfragenliste. |

## 11. Token-Verbrauch (`louis_token_usage`, TokenUsageTab.tsx) — 👁️ Anzeige

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| (keine Einstellungen — reine Statistik) | — | Zeigt den KI-Token-Verbrauch (pro Sitzung/Zeitraum) als Auswertung. |

## 12. Wissens-Skills (`louis_skills`, SkillsTab.tsx) — 🧩 Verwaltung

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Skill pinnen (📌) | Bei dauerhaft wichtigen Skills | Pinnnadeln halten einen Skill dauerhaft im Prompt (unabhängig vom Top-K). |
| Aktualisieren (Button) | Bei Bedarf | Lädt die Skill-Liste aus dem Wissensspeicher neu. |
| Status (aktiv/inaktiv/archiviert) | Vom Curator verwaltet | Zeigt, ob ein Skill aktiv einbezogen wird; inaktiv/archivierte werden nicht injiziert. |

## 13. LOUIS AI Workflows (`louis_workflows`, LouisAiWorkflowsTab.tsx + DagWorkflowEditor)

Automatisierte Abläufe, die Louis auf Zuruf, nach Zeitplan oder bei Ereignissen ausführt.

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Workflow-Name | Eindeutiger, sprechender Name | Bezeichnung des Ablaufs (z. B. „Überfällige Rechnungen prüfen"). |
| Workflow-ID | Kleinschrift mit Unterstrichen, z. B. check_overdue_invoices | Eindeutige Kennung — Louis startet den Ablauf über diesen Namen. |
| Zweck/Beschreibung | Klare Beschreibung | Erklärt Louis, wann/wie der Ablauf genutzt werden soll. |
| Trigger-Typ | MANUAL (Standard) — alternativ CRM_EVENT / TIMER | **MANUAL** = auf Zuruf; **CRM_EVENT** = bei Ereignis (z. B. Kontakt angelegt, Datei hochgeladen); **TIMER** = nach Zeitplan. |
| Trigger-Ereignis (bei CRM_EVENT) | passendes Ereignis wählen | Welches Ereignis den Ablauf startet. |
| Zeitplan (bei TIMER) | Zeitintervall wählen | Wann der Ablauf automatisch läuft. |
| Schritte (Tool-Kette) | Sinnvolle Reihenfolge von Aktionen | Die einzelnen Aktionen (z. B. „Rechnungen auflisten" → „E-Mail senden"). |
| Bedingungen pro Schritt | Nur bei Bedarf | Verzweigungen: Schritt wird nur unter bestimmten Bedingungen ausgeführt (z. B. wenn offene Rechnungen existieren). |
| Warte-Schritte (WAIT) | Nur wenn nötig | Pausiert den Ablauf bis zu einem Ereignis/Freigabe. |
| DAG-Editor (graphische Ansicht) | Bei komplexen Abläufen | Visuelle Darstellung und Bearbeitung von Verzweigungen. |
| Trockenlauf (Dry-Run) | Vor Aktivierung ausprobieren | Führt den Ablauf testweise aus, ohne echte Änderungen zu schreiben. |

## 14. Vorlagen (`notifications` → 5 Unterseiten, TemplatesTab.tsx)

### 14a. E-Mail-Vorlagen

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Vorlagenname | Eindeutiger Name | Bezeichnung der Vorlage. |
| Betreff | Mit Platzhaltern, z. B. „Rechnung {{invoice_number}}" | Betreffzeile der E-Mail (Platzhalter werden automatisch gefüllt). |
| Inhalt (Body) | Text mit Platzhaltern | E-Mail-Text; Platzhalter wie {{recipient_name}}, {{invoice_number}} werden befüllt. |
| AI-Kontext / AI-Wert | Optional | Zusätzliche KI-Anweisung oder Kontext für automatisch erzeugte E-Mails. |

### 14b. Signaturen

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Signaturname | Eindeutiger Name | Bezeichnung der Signatur. |
| Inhalt | Name, Rolle, Kontaktdaten, ggf. Logo | Textblock am Ende von E-Mails. |
| Als Standard | Eine Signatur als Standard | Wird neuen E-Mails automatisch vorbelegt. |

### 14c. Rechnungstexte

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Name | Eindeutiger Name | Bezeichnung des Textbausteins. |
| Inhalt | Textbaustein (z. B. Zahlungsbedingungen) | Wiederverwendbarer Text, der in Rechnungen eingefügt wird. |

### 14d. Angebots- & Rechnungsposten (Vorlagen für Positionen)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Name | Eindeutiger Name | Bezeichnung des Postens (z. B. „Softwarepflege"). |
| Beschreibung | Leistungsbeschreibung, ggf. mit Preis/Position | Vordefinierte Position, die in Angebote/Rechnungen übernommen wird. |

### 14e. Angebotstexte

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Name | Eindeutiger Name | Bezeichnung des Textbausteins. |
| Inhalt | Textbaustein (z. B. Gültigkeit, Leistungsumfang) | Wiederverwendbarer Text für Angebote. |

## 15. Massenimport / -export (`data_portability`, DataPortabilityTab.tsx)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Stammdaten-Import (Firmen/Kontakte) | CSV-Datei im passenden Format hochladen | Legt Firmen/Kontakte in großen Mengen an oder aktualisiert bestehende (per ID/E-Mail/Name abgeglichen). |
| Konflikt-Auflösung (resolve) | Treffer prüfen und bestätigen | Zeigt gefundene Übereinstimmungen vor dem Überschreiben zur Bestätigung an. |
| Vorlagen-/Text-Import | Datei hochladen | Importiert E-Mail-Vorlagen, Signaturen, Rechnungstexte, Posten, Angebotstexte. |
| Export | Exportieren (je Bereich) | Lädt die Daten als Datei herunter (z. B. für Backup oder Wechsel). |

## 16. Verbindungen (`connections`, ConnectionsTab.tsx + Forms)

### 16a. MCP-Server (externe Anbindungen)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Server-Name | Eindeutiger Name, z. B. „Obsidian Vault" | Bezeichnung der Anbindung. |
| Typ/Transport | passend zum Dienst (HTTP, STDIO …) | Wie die Anbindung angesprochen wird. |
| URL / Befehl | Adresse oder Startbefehl des Dienstes | Wo der Dienst erreichbar ist. |
| API-Key / Token | Schlüssel des Dienstes (verschlüsselt gespeichert) | Zugangsdaten der externen Anbindung. |
| Aktiv | An | Schaltet die Anbindung ein/aus (inaktiv = kein Kontext/Prompt-Verbrauch). |
| Tools entdecken / erlauben | Entdeckte Tools freischalten | Welche Werkzeuge des Dienstes Louis nutzen darf. |

### 16b. MCP-API-Keys (Zugang zu Louis' Schnittstelle)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Key-Name | Eindeutiger Name, z. B. „Cursor Agent" | Bezeichnung des Zugangsschlüssels. |
| Schlüssel (wird erzeugt) | Sicher aufbewahren | Ermöglicht externen Programmen (z. B. KI-Codierungsagenten) den Zugriff auf die Louis-Schnittstelle. |
| Berechtigungen/Scopes | Nur nötige Rechte (z. B. read) | Schränkt ein, was der Schlüssel darf. |

### 16c. Chat-Profile (MCP)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Name | Eindeutig (nach Anlage fix) | Bezeichnung des Chat-Profils (Kontext für externe Clients). |
| Beschreibung | Verständliche Beschreibung (editierbar) | Erklärt den Zweck des Profils. |
| Teamweit | Nach Bedarf | Profil für das ganze Team oder nur für einzelne Nutzer. |
| Erlaubte Tools | Profil-tools_json (Admin-editierbar) | Bestimmt, welche Werkzeuge das Profil nutzen darf. |

### 16d. Tool-Mappings & Freigaben (MCP)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Tool-Mapping | Externe Tools auf Louis-Tools abbilden | Ordnet Werkzeuge externer Dienste internen Funktionen zu. |
| Freigabe-Anfragen | Offene Anfragen prüfen/freigeben | Bestätigt Nutzungen externer Tools, die eine Freigabe benötigen. |

### 16e. SMTP (E-Mail-Versand)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Host | z. B. smtp.example.com (Ihr Mailserver) | Server, über den E-Mails versendet werden. |
| Port | 587 (STARTTLS) | Port des Mailservers. |
| Benutzername | E-Mail-Konto des Absenders | Anmeldename am Mailserver. |
| Passwort | App-Passwort des Kontos (verschlüsselt gespeichert) | Zugangsdaten des Mailservers. |
| Absender-E-Mail | z. B. noreply@example.com | Adresse, die als Absender erscheint. |
| Absender-Name | z. B. Louis CRM | Anzeigename des Absenders. |

### 16f. Telegram

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Bot-Token | Vom BotFather erzeugter Token | Verbindet den Telegram-Bot (Benachrichtigungen/Anfragen über Telegram). |
| Erlaubte User-IDs | Eigene Telegram-IDs (kommagetrennt) | Nur diese Nutzer dürfen den Bot verwenden (Sicherheit). |
| Aktiv | An | Schaltet die Telegram-Anbindung ein. |

### 16g. Websuche (WebSearchSettingsForm)

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| DuckDuckGo-URL | https://html.duckduckgo.com/html/ | Suchdienst 1 für die Websuche des Agenten. |
| SearXNG-URL | Eigene SearXNG-Instanz | Suchdienst 2 (privat, z. B. für bessere Ergebnisse). |
| SearXNG-Kategorien | Optional, z. B. general,news | Kategorien der SearXNG-Suche. |
| Google API-Key | Optional | Schlüssel für die Google-Suche (falls genutzt). |
| Google CX (Suchmaschinen-ID) | Optional | Suchmaschinen-ID der programmatischen Google-Suche. |

## 17. Audit-Protokolle (`logs`, AuditLogTable.tsx) — 👁️ Anzeige & Filter

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| Event-Typ-Filter | Keiner (alle) | Filtert nach Ereignistyp (z. B. CREATE, UPDATE, DELETE). |
| Akteur-Filter | Keiner (alle) | Filtert nach auslösendem Benutzer/System. |
| Entitäts-Filter | Keiner (alle) | Filtert nach Datenart (Kontakt, Firma, Rechnung …). |
| Zeitraum (von/bis) | Beliebig | Begrenzt die Anzeige auf einen Zeitraum. |
| Volltext-Suche | Suchbegriff | Durchsucht die Protokolltexte. |
| CSV-Export | Bei Bedarf | Lädt die gefilterten Protokolle als CSV herunter. |
| *(Aufbewahrung: siehe 5k — Audit-Log Aufbewahrung)* | Leer = kein Auto-Löschen | Automatische Bereinigung nach Tagen (falls gesetzt). |

## 18. Lizenzen & Credits (`licenses`, LicensesTab.tsx) — 👁️ Anzeige

| Einstellung | Empfohlener Wert | Wirkung (leicht verständlich) |
|---|---|---|
| (keine Einstellungen — reine Informationsseite) | — | Zeigt die Lizenzen des Systems (GPL, Drittanbieter-Lizenzen, Lizenzgeber-Informationen). |

