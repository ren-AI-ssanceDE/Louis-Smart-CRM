# 🎤 Sprachsteuerung (Voice & STT)

> **Historie:** Dieses Dokument war ursprünglich ein Implementierungsplan („Whisper Voice Integration“, 18.06.2026). Die Integration ist **umgesetzt** — der Inhalt wurde auf den Ist-Stand (August 2026) aktualisiert.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist die Sprachsteuerung?

Sie können mit **Louis Smart CRM sprechen** statt zu tippen:

* **Im Web-Chat (Louis AI Studio):** Ein Mikrofon-Button in der Chatzeile nimmt Ihre Sprache auf (mit Pegelanzeige) — das System wandelt sie in Text um und Louis arbeitet sie ab.
* **In Telegram:** Schicken Sie Louis eine **Sprachnachricht** — er versteht sie und antwortet.

**Beispiel:** Sie sagen *„Lege einen Kontakt Julia Sommer an, E-Mail julia@sommer.de“* — Louis transkribiert, versteht und erstellt den Entwurf (den Sie freigeben).

## Wo wird die Spracherkennung betrieben?

| Option | Vorteil | Hinweis |
|---|---|---|
| **Lokal (empfohlen)** | Ihre Audiodaten verlassen das Unternehmen nie — volle DSGVO-Kontrolle | Läuft als Docker-Container (Whisper) auf Ihrem System |
| **Cloud (OpenAI Whisper)** | Kein eigener Server nötig | Nur mit ausdrücklicher Freigabe; Daten gehen an den Anbieter |

## Einrichtung (einmalig, ~5 Minuten)

1. **Admin → Louis AI → Spracherkennung** öffnen.
2. **Provider wählen:** Lokal (empfohlen) oder OpenAI.
3. Beim lokalen Betrieb: Sprache wählen (Standard: Deutsch) — Modellgröße je nach Rechnerleistung.
4. Speichern und mit einer Testaufnahme prüfen — fertig.

## Gut zu wissen

* **DSGVO-freundlich:** Lokaler Betrieb heißt: Ihre Sprachaufnahmen bleiben bei Ihnen.
* **Ressourcen:** Spracherkennung braucht Rechenleistung. Auf kleineren Rechnern ein kleineres Modell (`tiny`/`base`) oder CPU-Modus wählen — langsamer, aber funktioniert überall.
* **Fachbegriffe:** Das System ist auf CRM-Begriffe trainiert („E-Rechnung“, „Kontakt“, „Workflow“ …) — sie werden zuverlässig erkannt.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Zielsetzung & Ansatz

* **Präzise Transkription**: Whisper (`large-v3` oder optimierte Derivate) liefert wortgetreue Transkriptionen mit korrekter Grammatik, Fachbegriffen und Interpunktion.
* **Volle Souveränität**: Lokal gehosteter Whisper-Server (`speaches`/`faster-whisper`) — Audiodaten verlassen das Unternehmen nicht.
* **Zwei Kanäle**:
  1. **Web-Interface (Louis AI Studio)**: Audio-Recorder mit Mikrofon-UI in der Chatzeile (`src/pages/LouisAi.tsx`)
  2. **Telegram Bot Gate**: Verarbeitung von Sprachnachrichten (`.ogg`/Opus)

## 2. Architektur

```
+----------------------------------+   +----------------------------------+
| Louis CRM Web-UI                 |   | telegram-bot-gate                |
| - MediaRecorder API (WebM/Ogg)   |   | - Empfängt message.voice         |
| - Mikrofon-UI mit Pegelanzeige   |   | - Lädt .ogg herunter             |
+----------------+-----------------+   +----------------+-----------------+
                 | (Upload-Request)                    | (Multipart-POST)
                 v                                     v
+-----------------------------------------------------------------------+
|                    Louis CRM Backend                                  |
|  - REST: POST /api/voice/transcribe (Multer)                          |
|  - Konvertierung via ffmpeg (falls nötig)                             |
|  - Auslesen der STT-Konfiguration (sys_integrations_stt_config)       |
+------------------------------------+----------------------------------+
                                     | (HTTP API Call)
                                     v
+-----------------------------------------------------------------------+
|                    STT Engine (Whisper)                               |
|  - Lokaler Docker-Container: speaches (faster-whisper, :8000)         |
|  - ODER OpenAI Whisper (nur bei expliziter Freigabe)                  |
+------------------------------------+----------------------------------+
                                     | (Antwort-Text)
                                     v
+-----------------------------------------------------------------------+
|                    Louis AI Orchestrator                              |
|  - Weitergabe des Transkripts an den ReAct-Loop                       |
+-----------------------------------------------------------------------+
```

## 3. Konfiguration (Admin-Panel → Louis AI → Spracherkennung)

| Feld | Bedeutung | Default |
|---|---|---|
| `sttProvider` | `disabled` / `local-whisper` / `openai-whisper` | `disabled` |
| `sttEndpoint` | z. B. `http://localhost:8000/v1/audio/transcriptions` | lokal |
| `sttApiKey` | optional, verschlüsselt | — |
| `sttModel` | z. B. `whisper-1` oder `large-v3` | `whisper-1` |
| `sttLanguage` | Sprachcode | `de` |
| `sttPrompt` | Initial-Prompt für Fachbegriffe („Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices“) | gesetzt |
| `sttDevice` | `auto` / `cpu` / `cuda` | `auto` |
| `sttQuantization` | `none` / `float16` / `int8` / `int8_float16` | `none` |
| `sttUnloadLlmOnDemand` | LLM im VRAM vor Transkription entladen | `false` |
| `sttFallbackOnCpu` | CPU-Fallback bei VRAM > 95 % | `false` |

Verwaltung: `settingsRouter` → `getSTTSettings` / `saveSTTSettings` (adminProcedure). **Keine hardcodierten Einstellungen** — alles DB-gestützt.

## 4. Lokales STT-Setup (Docker Compose)

```yaml
# Ergänzung/Auszug aus docker-compose.yml
whisper:
  image: ghcr.io/speaches-ai/speaches:latest-cpu   # oder -cuda
  container_name: louis-whisper-server
  restart: unless-stopped
  ports:
    - "8000:8000"
  environment:
    - WHISPER_MODEL=tiny        # z. B. tiny/base/small/medium/large-v3
    - CPU_THREADS=4
  volumes:
    - whisper_models:/home/ubuntu/.cache/huggingface/hub
```

## 5. Ressourcen- & VRAM-Betrachtung (lokaler Betrieb)

* **VRAM-Engpass**: Gleichzeitiger Betrieb lokaler LLMs und Whisper `large-v3` kann OOM verursachen (VRAM ≈ 95 %).
* **Alle Lösungen sind im Admin-Panel einstellbar**:
  1. **Device-Wahl & Quantisierung**: `cpu`/`cuda`, `int8_float16`/`int8` → Speicherbedarf anpassen
  2. **Unload-on-Demand**: lokales LLM vor Transkription entladen (z. B. Ollama `keep_alive=0`)
  3. **Dynamischer CPU-Fallback**: automatischer Wechsel bei VRAM > 95 %
  4. **Priorisierung**: blockieren oder (DSGVO-konform) auf Cloud-API zurückfallen

## 6. Integration in Louis AI & Telegram

* **Web-Chat**: Audio-Aufnahme in der Chatzeile; Transkript wird als normale Nachricht an Louis AI übergeben.
* **Telegram**: `telegram-bot-gate` fängt Sprachnachrichten ab, lädt die `.ogg`-Datei und leitet sie an `/api/voice/transcribe` weiter; Ergebnis geht in den ReAct-Loop.
* **Fehlerbehandlung**: STT-Ausfälle werden sauber geloggt (Audit), keine Abstürze.
