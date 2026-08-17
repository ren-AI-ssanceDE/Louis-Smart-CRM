# 🧠 Council Engine — Multi-Model-Konsens

> Die Council Engine ist ein **„KI-Expertenrat“**: Mehrere KI-Modelle (oder Rollen) diskutieren eine wichtige Frage und liefern Ihnen eine abgewogene Empfehlung. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist der Council (Rat)?

Stellen Sie sich vor, Sie versammeln für eine schwierige Entscheidung ein **Gremium aus Fachleuten** — eine Finanzexpertin, einen Datenschutz-Auditor, einen Strategen. Jeder schaut aus seiner Perspektive auf das Thema, tauscht Argumente aus und am Ende gibt es eine gemeinsame Empfehlung.

Genau das macht die Council Engine — nur mit KI-Modellen als Teilnehmern.

## Wann ist der Council sinnvoll?

Bei **wichtigen, vielschichtigen Entscheidungen**, bei denen eine einzelne KI-Antwort zu wenig wäre, z. B.:

* „Sollen wir die Zahlungsziele für A-Kunden auf 30 Tage verlängern?“
* „Ist unser Mahnprozess DSGVO-konform?“
* „Welche Preisstrategie passt zu unserem Kundenportfolio?“

## Wie funktioniert es?

1. **Thema festlegen** — Sie formulieren die Frage.
2. **Modus wählen**:
   * **Rollen-Modus:** Ein Modell schlüpft in mehrere Rollen (Finanz, DSGVO, Strategie) und antwortet aus jeder Perspektive.
   * **Multi-Modell-Modus:** Verschiedene KI-Modelle (z. B. Gemini + GPT + Claude) diskutieren miteinander.
3. **Debatte läuft automatisch:** Jede Runde äußern sich alle Teilnehmer, dann wird abgestimmt.
4. **Konsensbericht:** Am Ende fasst ein „Vorsitzender“ (Chairman) alles zu einer **klaren Empfehlung** zusammen.

## Wichtig zu wissen

* **Keine Entscheidung wird automatisch umgesetzt.** Der Council liefert nur eine Empfehlung — Sie entscheiden.
* **Ihre Daten bleiben im System** — die Sessions werden revisionssicher gespeichert (Audit).
* Die Auswahl der Modelle (welche Anbieter überhaupt erlaubt sind) liegt in Ihrer Admin-Konfiguration.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Konzept

* **Multi-Role-Modus**: Ein Modell übernimmt mehrere Rollen (z. B. Finanzexperte, DSGVO-Auditor, Strategie-Analyst) und analysiert eine Frage aus verschiedenen Blickwinkeln.
* **Multi-Model-Modus**: Verschiedene Anbieter/Modelle (Gemini, GPT-4, Claude, Llama — je nach Konfiguration) debattieren gegeneinander.
* **Ablauf**: Jede Runde → alle Teilnehmer äußern sich → Abstimmung → Synthese eines **Konsensberichts** (Chairman-Systemprompt).
* **Fallback**: `council.session_degraded_fallback`-Event, falls ein Modell ausfällt (Workflow-Trigger möglich).

## 2. Datenmodell & Konfiguration

* **Rollen**: `CANONICAL_COUNCIL_ROLES` (Finanzexperte, DSGVO-Auditor, Strategie-Analyst …) mit eigenen System-Prompts
* **Sessions** (`CouncilSessionSchema`): `topic`, `mode` (`multi-role | multi-model`), `status` (`draft | active | completed`), `maxRounds`, `currentRound`, `participants`, `finalConclusion`
* **Teilnehmer** (`CouncilParticipantSchema`): `providerId`, `modelId`, `systemPrompt`, `temperature`, `roleId`
* **Einstellungen**: `CouncilSettingsSchema` — im Admin-Bereich konfigurierbar (`CouncilSettingsTab`)
* **Speicherung**: `council_sessions` / `council_messages` (PostgreSQL + Fallback-Store)

## 3. API & Ablauf

* **Router**: `src/server/routers/council.ts` (Session-CRUD, `executeCouncilStep`, Konfiguration)
* **Engine**: `src/server/council/councilEngine.ts` (Runden-Steuerung, Abstimmung, Synthese)
* **Multi-Model-Client**: `src/server/council/multiModelClient.ts` (Provider-Abstraktion: Gemini, OpenAI-kompatibel, lokal)
* **Frontend**: `src/pages/Council.tsx` — Übersicht, Session-Steuerung, Ergebnis-Anzeige

### Typischer Ablauf
1. Frage/Thema festlegen + Modus wählen (z. B. „Sollen wir die Zahlungsziele für A-Kunden auf 30 Tage verlängern?“)
2. Teilnehmer (Rollen oder Modelle) konfigurieren
3. Runden laufen automatisch: Statement → Gegenrede → Abstimmung
4. Chairman synthetisiert den **finalen Konsensbericht** mit Empfehlung

## 4. Integration

* **Workflows**: `council.session_degraded_fallback` als Trigger-Ereignis nutzbar.
* **Audit**: Council-Sessions werden revisionssicher protokolliert.
* **DSGVO**: Alle Daten bleiben in der eigenen Instanz; keine Weitergabe an Dritte (Provider-Auswahl ist Admin-Sache).
