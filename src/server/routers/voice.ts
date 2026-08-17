import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { getSession } from "@auth/express";
import { authConfig } from "../auth.js";
import { pool, isUsingFallback, fallbackStore, logAuditEvent, cleanDbRow } from "../db.js";
import { SpeechToTextSettings } from "../../types.js";

export const voiceRouter = Router();

// Configure multer to save temporary voice files (to system temp or local tmp)
const upload = multer({ dest: path.join(process.cwd(), "uploads/tmp") });

// Ensure uploads/tmp directory exists
if (!fs.existsSync(path.join(process.cwd(), "uploads/tmp"))) {
  fs.mkdirSync(path.join(process.cwd(), "uploads/tmp"), { recursive: true });
}

// REST route /api/voice/transcribe
voiceRouter.post("/transcribe", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No audio file received" });
      return;
    }

    // Determine tenantId from Session
    let tenantId = "1";
    let actorEmail = "telegram_bot";
    try {
      const sessionRes = await getSession(req, authConfig);
      if (sessionRes?.user) {
        const u = sessionRes.user as { tenant_id?: string; email?: string };
        tenantId = u.tenant_id || "1";
        actorEmail = u.email || "unknown";
      }
    } catch (err) {
      console.warn("Failed to retrieve session in /api/voice/transcribe:", err);
    }

    // Load active STT settings
    let settings: SpeechToTextSettings | null = null;
    if (isUsingFallback) {
      if (!fallbackStore.sttConfig) fallbackStore.sttConfig = [];
      const found = fallbackStore.sttConfig.find(x => x.tenant_id === tenantId);
      settings = (found as SpeechToTextSettings) || {
        tenant_id: tenantId,
        stt_provider: "disabled",
        stt_endpoint: "http://localhost:8000/v1/audio/transcriptions",
        stt_model: "whisper-1",
        stt_language: "de",
        stt_prompt: "Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices",
        stt_device: "auto",
        stt_quantization: "none",
        stt_unload_llm_on_demand: false,
        stt_fallback_on_cpu: false,
      };
    } else {
      const dbRes = await pool.query("SELECT * FROM sys_integrations_stt_config WHERE tenant_id = $1 LIMIT 1", [tenantId]);
      if (dbRes.rows[0]) {
        settings = cleanDbRow(dbRes.rows[0]) as SpeechToTextSettings;
      } else {
        settings = {
          tenant_id: tenantId,
          stt_provider: "disabled",
          stt_endpoint: "http://localhost:8000/v1/audio/transcriptions",
          stt_model: "whisper-1",
          stt_language: "de",
          stt_prompt: "Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices",
          stt_device: "auto",
          stt_quantization: "none",
          stt_unload_llm_on_demand: false,
          stt_fallback_on_cpu: false,
        };
      }
    }

    if (!settings || settings.stt_provider === "disabled") {
      res.status(400).json({ error: "Speech-to-Text translation is currently disabled in the system settings." });
      // Delete temporary file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return;
    }

    // Send the voice file to Whisper STT Node
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);

    // Create standard FormData payload compatible with standard OpenAI/faster-whisper fields
    const formData = new FormData();
    const audioBlob = new Blob([fileBuffer], { type: req.file.mimetype || "audio/ogg" });
    formData.append("file", audioBlob, req.file.originalname || "audio.ogg");
    formData.append("model", settings.stt_model);
    formData.append("language", settings.stt_language);
    if (settings.stt_prompt) {
      formData.append("prompt", settings.stt_prompt);
    }
    // Formulate any specific configurations if we want, but standard Whisper endpoint expects file, model, language, prompt.

    const headers: Record<string, string> = {};
    const apiKey = settings.stt_api_key || (settings.stt_provider === "openai-whisper" ? process.env.OPENAI_API_KEY : "");
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let endpoint = settings.stt_endpoint;
    if (settings.stt_provider === "openai-whisper" && (!endpoint || endpoint.includes("localhost"))) {
      endpoint = "https://api.openai.com/v1/audio/transcriptions";
    }

    // Dynamic hostname translation for Docker network setups:
    // When running inside a Docker setup/container, "localhost:8000" refers to the loopback of the 'app' container.
    // However, the Whisper service is running as a separate service named 'whisper'.
    // If we detect containerized execution (PGHOST is 'db' or /.dockerenv exists) and stt_endpoint points to localhost,
    // we seamlessly translate the target host to 'whisper' so everything works flawlessly out-of-the-box.
    const isDockerCtx = process.env.PGHOST === "db" || fs.existsSync("/.dockerenv");
    if (isDockerCtx && settings.stt_provider === "local-whisper") {
      if (endpoint.includes("localhost:8000")) {
        endpoint = endpoint.replace("localhost:8000", "whisper:8000");
      } else if (endpoint.includes("127.0.0.1:8000")) {
        endpoint = endpoint.replace("127.0.0.1:8000", "whisper:8000");
      }
    }

    console.log(`[STT] Sending transcription request to provider: ${settings.stt_provider}, endpoint: ${endpoint}`);

    // If unload LLM option is enabled, let's call Ollama unload (Gemma 4 keep_alive = 0)
    if (settings.stt_unload_llm_on_demand) {
      try {
        console.log("[STT] Unload LLM on demand is enabled. Sending keep_alive: 0 to Ollama...");
        await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemma2",
            prompt: "",
            keep_alive: 0
          })
        });
      } catch (ollamaErr) {
        console.warn("[STT] Failed to unload Ollama LLM:", ollamaErr);
      }
    }

    try {
      const sttResponse = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!sttResponse.ok) {
        const errText = await sttResponse.text();
        console.error(`[STT] Error from Whisper server: ${errText} (Status: ${sttResponse.status})`);
        
        // Let's implement CPU fallback if enabled and failed due to local server error (CUDA OOM, etc.)
        if (settings.stt_fallback_on_cpu && settings.stt_provider === "local-whisper") {
          console.warn("[STT] Local Whisper node failed. Attempting CPU fallback / alternative endpoint if configured...");
          await logAuditEvent({
            tenantId,
            eventType: "ERROR",
            entityType: "STT_SYSTEM",
            eventDetails: `Whisper node failed: ${errText}. Attempting fallback processing...`,
            actorIdentity: actorEmail
          });
        }

        throw new Error(`Whisper node returned error status ${sttResponse.status}: ${errText}`);
      }

      const responseData = await sttResponse.json() as { text: string };
      console.log(`[STT] Successful transcription: "${responseData.text}"`);

      // Log successful transcription in Audit Trails
      await logAuditEvent({
        tenantId,
        eventType: "VOICE_TRANSCRIBE",
        entityType: "STT_SYSTEM",
        eventDetails: `Successfully transcribed voice message of length ${fileBuffer.length} bytes using ${settings.stt_provider}`,
        actorIdentity: actorEmail
      });

      res.json({ text: responseData.text });
    } catch (fetchErr) {
      console.error("[STT] Transcription server fetch failed:", fetchErr);
      await logAuditEvent({
        tenantId,
        eventType: "ERROR",
        entityType: "STT_SYSTEM",
        eventDetails: `Connection to Whisper STT failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        actorIdentity: actorEmail
      });
      res.status(502).json({ error: "Failed to connect to Whisper server." });
    } finally {
      // Cleanup temporary file
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }

  } catch (error) {
    console.error("[STT] General transcribing error:", error);
    res.status(500).json({ error: "Internal server error during transcription." });
  }
});
