import { URL } from "url";

// Register global error listeners to prevent the Node.js process from crashing on unhandled rejections or exceptions.
process.on("uncaughtException", (err) => {
  console.error("🔥 [CRITICAL] Uncaught Exception in Telegram Gateway:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 [CRITICAL] Unhandled Promise Rejection at promise:", promise, "reason:", reason);
});

const CRM_CONFIG_API = process.env.CRM_CONFIG_API || "http://app:3000/api/telegram/config";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://app:3000/api/mcp/sse";

let currentBotToken = "";
let currentAllowedUserIds = "";
let currentIsActive = false;

let pollingActive = false;
let updateOffset = 0;

async function startGateway() {
  console.log("=== Louis Smart CRM Telegram Gateway starting ===");
  console.log(`CRM Config API pointer: ${CRM_CONFIG_API}`);
  console.log(`MCP SSE Server pointer: ${MCP_SERVER_URL}`);

  // Start periodic config check loop
  await pollConfigLoop();
}

async function pollConfigLoop() {
  while (true) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout
      
      const response = await fetch(CRM_CONFIG_API, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        
        const tokenChanged = data.bot_token !== currentBotToken;
        const statusChanged = data.is_active !== currentIsActive;
        const usersChanged = data.allowed_user_ids !== currentAllowedUserIds;

        if (tokenChanged || statusChanged || usersChanged) {
          console.log("[CONFIG] Active configuration updated:", {
            bot_token: data.bot_token ? `${data.bot_token.substring(0, 8)}...` : "(none)",
            is_active: data.is_active,
            allowed_user_ids: data.allowed_user_ids
          });

          currentBotToken = data.bot_token || "";
          currentAllowedUserIds = data.allowed_user_ids || "";
          currentIsActive = !!data.is_active;

          if (currentIsActive && currentBotToken) {
            restartPollingLoop();
          } else {
            stopPollingLoop();
          }
        }
      } else {
        if (response.status === 404) {
          if (currentIsActive) {
            console.log("[CONFIG] Telegram bot profile turned OFF by CRM administrator.");
            stopPollingLoop();
          }
        } else {
          console.warn(`[CONFIG] Fetching telegram config failed with status: ${response.status}`);
        }
      }
    } catch (err) {
      console.error("[CONFIG] Connection error polling configurations endpoint:", err.message);
    }

    await sleep(15000);
  }
}

function restartPollingLoop() {
  stopPollingLoop();
  pollingActive = true;
  updateOffset = 0;
  console.log("[POLLING] Initializing standard long-polling message stream with Telegram API...");
  telegramPollingLoop();
}

function stopPollingLoop() {
  if (pollingActive) {
    console.log("[POLLING] SUSPENDED: Telegram updates retrieval loop stopped.");
    pollingActive = false;
  }
}

async function telegramPollingLoop() {
  const activeToken = currentBotToken;
  
  while (pollingActive && activeToken === currentBotToken) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 seconds timeout for long polling (which has timeout=20)

      const url = `https://api.telegram.org/bot${activeToken}/getUpdates?offset=${updateOffset}&timeout=20`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error(`[Telegram API] Error getting updates, status: ${response.status}`);
        await sleep(5000);
        continue;
      }

      const body = await response.json();
      if (body && body.ok && body.result && body.result.length > 0) {
        for (const update of body.result) {
          if (update.update_id >= updateOffset) {
            updateOffset = update.update_id + 1;
          }
          if (update.message && update.message.text) {
            handleIncomingMessage(update.message).catch(e => {
              console.error("[Telegram API] Failed to handle update message:", e);
            });
          }
        }
      }
    } catch (err) {
      console.error("[Telegram API] Error in updates stream:", err.message);
      await sleep(5000);
    }
  }
}

// Helper to parse key-value inputs
function parseKeyValuePairs(text) {
  const result = {};
  const segments = text.split(";");
  for (const segment of segments) {
    const parts = segment.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase();
      const val = parts.slice(1).join("=").trim();
      result[key] = val;
    }
  }
  return result;
}

// Try finding a company UUID or contact UUID by name locally using mcp
async function resolveCompanyId(searchTerm) {
  if (!searchTerm) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)) {
    return searchTerm; // Already a UUID
  }
  try {
    const listJson = await callMcpTool("search_contacts", { query: searchTerm });
    if (!listJson || typeof listJson !== "string" || listJson.startsWith("⚠️")) return undefined;
    const list = JSON.parse(listJson);
    if (Array.isArray(list) && list.length > 0) {
      // Find matching item
      for (const item of list) {
        if (item.company_name && item.company_name.toLowerCase().includes(searchTerm.toLowerCase())) {
          return item.associated_company_id || item.id_uuid;
        }
      }
      return list[0].id_uuid;
    }
  } catch (e) {
    console.error("resolveCompanyId failed:", e);
  }
  return undefined;
}

async function resolveContactId(searchTerm) {
  if (!searchTerm) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)) {
    return searchTerm;
  }
  try {
    const listJson = await callMcpTool("search_contacts", { query: searchTerm });
    if (!listJson || typeof listJson !== "string" || listJson.startsWith("⚠️")) return undefined;
    const list = JSON.parse(listJson);
    if (Array.isArray(list) && list.length > 0) {
      return list[0].id_uuid;
    }
  } catch (e) {
    console.error("resolveContactId failed:", e);
  }
  return undefined;
}

async function handleIncomingMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = (message.text || "").trim();

  console.log(`[Message] Received: "${text}" from Chat ${chatId} / User ID ${userId}`);

  // Security authorization checks
  const allowed = currentAllowedUserIds.split(",").map(id => id.trim());
  if (!allowed.includes(String(chatId)) && !allowed.includes(String(userId))) {
    console.warn(`[Security Check] REJECTED: Access denied for Chat ${chatId} / User ID ${userId}`);
    await sendTelegramMessage(chatId, "🚫 *Zugriff verweigert.*\nSie sind nicht berechtigt, auf diese CRM-Instanz zuzugreifen.");
    return;
  }

  const matchesCommand = text.startsWith("/");
  const commandWord = matchesCommand ? text.split(" ")[0].toLowerCase() : "";
  const commandArgs = matchesCommand ? text.substring(commandWord.length).trim() : text;

  // 1. HELP / START Command (Conversational Intro)
  if (commandWord === "/start" || commandWord === "/hilfe" || commandWord === "/help" || (!matchesCommand && text.toLowerCase() === "hilfe")) {
    const welcome = `✈️ *Louis Smart CRM Chat - Telegram Gateway* (100% Local-Only)
Ich bin dein persönlicher Louis-Assistent. Du musst ab sofort keine starren Befehle oder kryptischen Tastenkürzel mehr nutzen! 

Du kannst dich ganz natürlich in Alltagssprache mit mir unterhalten, genau so wie im originalen Louis CRM-Chat in deiner Webanwendung. Der leistungsstarke Louis AI Co-Pilot (Ollama/Gemini) übernimmt im Hintergrund alle Suchen und Datenbankoperationen für dich.

*Musterbeispiele für deine Nachrichten:*
• 🔍 *Suchen:* „Suche nach Kontakten in Berlin“ oder „Gibt es eine Firma namens Muster?“
• 🏢 *Firmen:* „Schreibe einen Entwurf für ein neues Unternehmen: Muster GmbH in Hamburg“
• 👤 *Kontakte:* „Erstelle einen Kontakt für Max Müller, E-Mail max@web.de“
• 🧾 *Rechnungen:* „Erstelle einen Rechnungsentwurf für die Acme AG over 4 Stunden Webdesign consulting“
• 📊 *Analyse:* „Wer hat noch nicht gezahlt? Zeige mir alle offenen Rechnungen“ oder „Wieviel Umsatz haben wir diesen Monat gemacht?“

*Meta-Steuerung:*
• \`/status\` - Prüft den Online-Status und die Core-Module deines CRM-Systems.
• \`/vergessen\` oder \`/reset\` - Löscht den gesamten bisherigen Verlauf dieses Chats komplett, damit wir frisch starten können.

Schreib mir einfach direkt, was du tun möchtest!`;
    await sendTelegramMessage(chatId, welcome);
    return;
  }

  // 2. STATUS Command
  if (commandWord === "/status") {
    await sendTelegramAction(chatId, "typing");
    try {
      const statsJson = await callMcpTool("search_contacts", { query: "" });
      if (statsJson && typeof statsJson === "string" && !statsJson.startsWith("⚠️")) {
        const stats = JSON.parse(statsJson);
        await sendTelegramMessage(chatId, `🟢 *Louis Gateway Status* (Aktiv)
• *Daten-Verschlüsselung*: SSL Direct (100% Local Safe)
• *Schnittstellen-Modus*: 100% Conversational Interface (Ollama / Gemini)
• *MCP-Schnittstelle*: SSE Verbindung hergestellt
• *CRM Treffer-Pool*: ${Array.isArray(stats) ? stats.length : 0} Kontakte im Register`);
      } else {
        throw new Error(statsJson || "Invalid response from CRM");
      }
    } catch (e) {
      await sendTelegramMessage(chatId, `⚠️ *Louis Status-Warnung*
• Verbindung zum lokalen CRM-Dienst ist gestört oder das Datenregister ist leer.
• Fehler: ${e.message}`);
    }
    return;
  }

  // 2.5 CLEAR / RESET Command
  if (commandWord === "/reset" || commandWord === "/vergessen" || commandWord === "/clear") {
    await sendTelegramAction(chatId, "typing");
    try {
      const reply = await callMcpTool("clear_louis_chat", { session_id: String(chatId) });
      if (reply === "SUCCESS") {
        await sendTelegramMessage(chatId, "🧹 *Chat-Verlauf vergessen!*\nIch habe alle vorherigen Nachrichten und den Kontext aus diesem Chat vollständig gelöscht. Wir starten jetzt einen komplett neuen Gesprächsfaden!");
      } else {
        await sendTelegramMessage(chatId, `⚠️ *Fehler beim Zurücksetzen:* ${reply}`);
      }
    } catch (e) {
      await sendTelegramMessage(chatId, `⚠️ *Fehler beim Zurücksetzen:* ${e.message}`);
    }
    return;
  }

  // 3. Conversational Router
  // If they used a legacy command, we translate it gracefully to natural language to keep Ollama in charge.
  let targetQuery = text;
  if (matchesCommand) {
    if (commandWord === "/suche" || commandWord === "/search") {
      targetQuery = `Suche nach "${commandArgs}" in meinen CRM-Daten.`;
    } else if (commandWord === "/analyst") {
      targetQuery = `Analysiere folgende CRM-Frage: ${commandArgs}`;
    } else if (commandWord === "/firma") {
      targetQuery = `Erstelle einen Entwurf für ein Unternehmen: ${commandArgs}`;
    } else if (commandWord === "/kontakt") {
      targetQuery = `Erstelle einen Entwurf für einen Kontakt: ${commandArgs}`;
    } else if (commandWord === "/rechnung") {
      targetQuery = `Erstelle einen Rechnungsentwurf: ${commandArgs}`;
    }
  }

  await sendTelegramAction(chatId, "typing");
  await processChatWithLouis(chatId, targetQuery);
}

async function processChatWithLouis(chatId, query) {
  try {
    const replyStr = await callMcpTool("chat_with_louis", { message: query, session_id: String(chatId) });
    await sendTelegramMessage(chatId, replyStr);
  } catch (err) {
    await sendTelegramMessage(chatId, `⚠️ *Bypass-Fehler:* ${err.message}`);
  }
}

async function callMcpTool(toolName, args) {
  try {
    console.log(`[MCP Client] Connecting to SSE server at: ${MCP_SERVER_URL}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout for SSE handshake
    
    const response = await fetch(MCP_SERVER_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`SSE handshaking failed, status code: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Response body is null. Cannot read SSE stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let endpointUrl = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        let currentEvent = "";
        
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.replace("event:", "").trim();
          } else if (line.startsWith("data:") && currentEvent === "endpoint") {
            endpointUrl = line.replace("data:", "").trim();
            break;
          }
        }
        if (endpointUrl) {
          break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch (cancelErr) {
        console.warn("Non-critical error cancelling reader:", cancelErr.message);
      }
    }

    if (!endpointUrl) {
      throw new Error("Missing endpoint redirect URL inside SSE connector payload stream.");
    }

    const baseUrl = new URL(MCP_SERVER_URL).origin;
    const finalPostUrl = endpointUrl.startsWith("http") ? endpointUrl : `${baseUrl}${endpointUrl}`;

    console.log(`[MCP Client] Executing Tool: "${toolName}" on routing path: ${finalPostUrl}`);

    const callController = new AbortController();
    const callTimeoutId = setTimeout(() => callController.abort(), 50000); // 50 seconds timeout for agent actions

    const callResponse = await fetch(finalPostUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: callController.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 100000),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      })
    });
    clearTimeout(callTimeoutId);

    if (!callResponse.ok) {
      throw new Error(`Tool call failed, HTTP status: ${callResponse.status}`);
    }

    const outputJson = await callResponse.json();
    if (outputJson.error) {
      throw new Error(outputJson.error.message || "Unknown server response JSON-RPC error.");
    }

    return outputJson.result?.content?.[0]?.text || "";
  } catch (err) {
    console.error("[MCP Client] Failed to execute tool call on CRM server:", err);
    return `⚠️ Kommunikation fehlgeschlagen: ${err.message}`;
  }
}

function markdownToTelegramHtml(markdown) {
  if (!markdown) return "";

  // 1. Escape HTML special characters
  let text = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const placeholders = [];

  // 2. Multi-line code blocks
  text = text.replace(/```(?:[a-zA-Z0-9_\-+]+)?\n([\s\S]*?)```/g, (match, code) => {
    const id = `##PRE_BLOCK_PLACEHOLDER_${placeholders.length}##`;
    placeholders.push({
      id,
      html: `<pre>${code}</pre>`
    });
    return id;
  });

  // 3. Inline code
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    const id = `##CODE_BLOCK_PLACEHOLDER_${placeholders.length}##`;
    placeholders.push({
      id,
      html: `<code>${code}</code>`
    });
    return id;
  });

  // 4. Bullet Points
  text = text.replace(/^[ \t]*[-\*][ \t]+([^\n]+)/gm, "• $1");

  // 5. Headings
  text = text.replace(/^(?:[ \t]*)(#{1,6})[ \t]+([^\n]+)/gm, "<b>$2</b>");

  // 6. Bold (Double and single asterisks)
  text = text.replace(/(?:^|(?<=\s))\*\*(?=\S)([^*]+?)(?<=\S)\*\*(?=$|\s|[.,;:!?])/g, "<b>$1</b>");
  text = text.replace(/(?:^|(?<=\s))\*(?=\S)([^*]+?)(?<=\S)\*(?=$|\s|[.,;:!?])/g, "<b>$1</b>");
  text = text.replace(/(?:^|(?<=\s))__(?=\S)([^_]+?)(?<=\S)__(?=$|\s|[.,;:!?])/g, "<b>$1</b>");

  // 7. Italic (Underscores)
  text = text.replace(/(?:^|(?<=\s))_(?=\S)([^_]+?)(?<=\S)_(?=$|\s|[.,;:!?])/g, "<i>$1</i>");

  // 8. Blockquotes (using original > which is now escaped as &gt;)
  text = text.replace(/^[ \t]*&gt;[ \t]*([^\n]+)/gm, "<blockquote>$1</blockquote>");

  // 9. Links: [text](url) -> <a href="url">text</a>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    let href = url.trim();
    if (!/^(?:f|ht)tps?:\/\//i.test(href) && !/^tg:\/\//i.test(href)) {
      href = "https://" + href;
    }
    return `<a href="${href}">${linkText}</a>`;
  });

  // 10. Restore code placeholders
  for (const p of placeholders) {
    text = text.replace(p.id, p.html);
  }

  return text;
}

async function sendTelegramMessage(chatId, text) {
  try {
    let msgText = text || "";
    if (msgText.length > 4096) {
      console.log(`[Telegram send] Message exceeds 4096 chars (${msgText.length}). Truncating...`);
      msgText = msgText.substring(0, 4093) + "...";
    }

    // Convert markdown to super-safe Telegram HTML format
    const htmlText = markdownToTelegramHtml(msgText);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    const url = `https://api.telegram.org/bot${currentBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: "HTML"
      })
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      let errBody = "";
      try {
        errBody = await res.text();
      } catch (e) {
        errBody = e.message;
      }
      console.error(`[Telegram send] Failed to transmit HTML message, status: ${res.status}, response: ${errBody}`);
      
      // Fallback: Retry sending WITHOUT parse_mode (pure plain text) to ensure delivery
      console.log(`[Telegram send] Retrying message delivery without parse_mode formatting as fallback...`);
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
      const retryRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: retryController.signal,
        body: JSON.stringify({
          chat_id: chatId,
          text: msgText
        })
      });
      clearTimeout(retryTimeoutId);
      
      if (!retryRes.ok) {
        let retryErrBody = "";
        try {
          retryErrBody = await retryRes.text();
        } catch (e) {
          retryErrBody = e.message;
        }
        console.error(`[Telegram send] Fallback transmission also failed, status: ${retryRes.status}, response: ${retryErrBody}`);
      } else {
        console.log(`[Telegram send] Fallback message delivered successfully without parse_mode!`);
      }
    }
  } catch (err) {
    console.error("[Telegram send] Error:", err.message);
  }
}

async function sendTelegramAction(chatId, action) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout
    
    const url = `https://api.telegram.org/bot${currentBotToken}/sendChatAction`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        action: action
      })
    });
    clearTimeout(timeoutId);
  } catch (e) {
    // Ignore cosmetic actions failures
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

startGateway();
