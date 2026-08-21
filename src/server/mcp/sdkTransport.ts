// MCP-SDK-Transport-Schicht (Task B.1, Plan 2026-08-19)
// Kapselt @modelcontextprotocol/sdk (v1.30.0, Subpath-Exports) + Stateless-Raw-Fallback
// für 2026-07-28-Server (server/discover — das SDK hat KEIN discover()/request()).
// Referenz-Muster: Protokoll-Negotiation (auto/stateless/legacy) + Fehler-Sanitizer (bewährtes Client-Verhalten).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { spawn } from "node:child_process";
import { Agent as UndiciAgent } from "undici";
import type { McpExternalServer } from "../../types.js";

// --- Neue Konfig-Felder (C.3 erweitert Schema/DB/UI; hier schon lesbar) ------
export interface ServerConfigOverrides {
  protocol?: string | null;
  connect_timeout_s?: number | null;
  ssl_verify?: boolean | null;
  client_cert?: string | null;
  client_key?: string | null;
  keepalive_interval_s?: number | null;
  idle_timeout_s?: number | null;
  max_lifetime_s?: number | null;
  trust?: string | null;
  supports_parallel_tool_calls?: boolean | null;
  custom_headers?: string | null;
}

export type ServerWithConfig = McpExternalServer & ServerConfigOverrides;

export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

// --- Fehler-Sanitizer (Credentials/Token in Fehlertexten maskieren) ------------------------------

const CREDENTIAL_PATTERN =
  /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|Basic\s+[A-Za-z0-9+/=]+|(?:api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+)/gi;

/** Credential-artige Muster aus Fehlertexten entfernen, bevor sie an LLM/Logs gehen. */
export function sanitizeErrorText(text: string): string {
  return text.replace(CREDENTIAL_PATTERN, "[REDACTED]");
}

// --- Fehler-Klassifikation ---------------------------------------------------

function errorCode(err: unknown): number | undefined {
  const e = err as { code?: unknown; error?: { code?: unknown }; message?: unknown };
  // JSON-RPC-Code zuerst aus der Message extrahieren — SDK-Fehler tragen oft HTTP-Status
  // als `code` (z. B. 400) und den echten MCP-Code (-32022) nur im Text.
  const msg = typeof e?.message === "string" ? e.message : "";
  const m = msg.match(/-32\d{3}/);
  if (m) return Number(m[0]);
  const code = e?.code ?? e?.error?.code;
  if (typeof code === "number") return code;
  return undefined;
}

export function isUnsupportedProtocolError(err: unknown): boolean {
  return errorCode(err) === -32022;
}

export function isMethodNotFoundError(err: unknown): boolean {
  return errorCode(err) === -32601;
}

function errText(err: unknown): string {
  const e = err as { message?: unknown; error?: { message?: unknown } };
  const msg = typeof e?.message === "string" ? e.message : e?.error?.message;
  return typeof msg === "string" ? msg : String(err);
}

// --- TLS-Dispatcher (self-signed-Toleranz, mTLS) ------------------------------

function buildDispatcher(server: ServerWithConfig): unknown {
  const url = server.endpoint_or_command;
  if (!url.startsWith("https://")) return undefined;
  const overrides = server as ServerConfigOverrides;
  const connect: Record<string, unknown> = {};
  if (overrides.ssl_verify === true) {
    // strict: System-CAs verwenden (kein rejectUnauthorized-Flag)
    connect.rejectUnauthorized = true;
  } else {
    // Default (false/undefined): self-signed tolerieren (bisheriges Verhalten)
    connect.rejectUnauthorized = false;
  }
  const cert = overrides.client_cert;
  const key = overrides.client_key;
  if (cert) {
    connect.cert = cert;
    if (key) connect.key = key;
  }
  return new UndiciAgent({ connect });
}

// --- Stateless-Raw-Client (2026-07-28 server/discover) ------------------------

interface StatelessConfig {
  endpoint: string; // http(s)-URL ODER command (stdio)
  args: string[];
  headers: Record<string, string>;
  envVars: Record<string, string>;
  timeoutMs: number;
  dispatcher: unknown;
}

interface StatelessJsonRpcResult {
  result?: unknown;
  error?: { code?: number; message?: string };
  raw?: unknown;
}

function parseStatelessBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    const blocks: string[] = [];
    let inData = false;
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data:")) {
        blocks.push(line.slice(5).trim());
        inData = true;
      } else if (line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) {
        inData = false;
      } else if (inData && line.trim() !== "") {
        blocks[blocks.length - 1] += line.trim();
      }
    }
    let last: unknown = null;
    for (const b of blocks) {
      try {
        last = JSON.parse(b);
      } catch {
        /* einzelnes Event ignorieren */
      }
    }
    return last;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

export class StatelessMcpClient {
  private child: ReturnType<typeof spawn> | null = null;
  private pending = new Map<number, (v: StatelessJsonRpcResult) => void>();
  private stdoutBuf = "";
  private nextId = 1;

  constructor(private cfg: StatelessConfig) {}

  private async requestHttp(method: string, params: unknown): Promise<StatelessJsonRpcResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const init: RequestInit & { dispatcher?: unknown } = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.cfg.headers
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params: params ?? {} }),
        signal: controller.signal
      };
      if (this.cfg.dispatcher) init.dispatcher = this.cfg.dispatcher;
      const res = await fetch(this.cfg.endpoint, init);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { error: { message: `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}` } };
      }
      const parsed = parseStatelessBody(await res.text()) as StatelessJsonRpcResult;
      if (parsed && "error" in parsed && parsed.error) return { error: parsed.error };
      return parsed ?? { error: { message: "Leere Antwort vom MCP-Server" } };
    } catch (err) {
      const aborted = (err as { name?: string }).name === "AbortError";
      return { error: { message: aborted ? `Timeout nach ${this.cfg.timeoutMs}ms` : errText(err) } };
    } finally {
      clearTimeout(timer);
    }
  }

  private ensureStdio(): void {
    if (this.child && !this.child.killed) return;
    const isWinNpx = process.platform === "win32" && this.cfg.endpoint === "npx";
    const cmd = isWinNpx ? "cmd" : this.cfg.endpoint;
    const args = isWinNpx ? ["/c", "npx", ...this.cfg.args] : this.cfg.args;
    this.child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.cfg.envVars }
    });
    this.pending = new Map();
    this.stdoutBuf = "";
    this.child.stdout?.on("data", (d: Buffer) => {
      this.stdoutBuf += d.toString();
      let idx: number;
      while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
        const line = this.stdoutBuf.slice(0, idx);
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { code?: number; message?: string } };
          const resolve = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
          if (resolve) {
            this.pending.delete(msg.id);
            resolve(msg.error ? { error: msg.error } : { result: msg.result });
          }
        } catch {
          /* Nicht-JSON-Zeile ignorieren */
        }
      }
    });
    this.child.on("exit", (code) => {
      const err = { error: { message: `stdio-Prozess beendet (exit ${code})` } };
      for (const resolve of this.pending.values()) resolve(err);
      this.pending = new Map();
      this.child = null;
    });
  }

  private requestStdio(method: string, params: unknown): Promise<StatelessJsonRpcResult> {
    this.ensureStdio();
    if (!this.child) return Promise.resolve({ error: { message: "stdio-Prozess nicht verfügbar" } });
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { message: `Timeout nach ${this.cfg.timeoutMs}ms` } });
        this.child?.kill();
      }, this.cfg.timeoutMs);
      this.pending.set(id, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      this.child!.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n");
    });
  }

  async request(method: string, params?: unknown): Promise<StatelessJsonRpcResult> {
    if (this.cfg.endpoint.startsWith("http://") || this.cfg.endpoint.startsWith("https://")) {
      return this.requestHttp(method, params);
    }
    return this.requestStdio(method, params);
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    const res = await this.request("ping");
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true };
  }

  async listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }>; error?: string }> {
    const res = await this.request("tools/list");
    if (res.error) return { tools: [], error: res.error.message };
    const r = res.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }> };
    return { tools: r?.tools ?? [] };
  }

  async callTool(name: string, args: unknown): Promise<{ content?: unknown; isError?: boolean; error?: string }> {
    const res = await this.request("tools/call", { name, arguments: args ?? {} });
    if (res.error) return { error: res.error.message };
    const r = res.result as { content?: unknown; isError?: boolean };
    return { content: r?.content, isError: r?.isError === true };
  }

  close(): void {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
  }
}

// --- Session-Handle & Negotiation ---------------------------------------------

export type McpSessionHandle =
  | {
      kind: "sdk";
      client: Client;
      transport: ReturnType<typeof buildSdkTransport>;
      timeoutMs: number;
      // Kompatibilitäts-Fallback: Server, deren tools/list- oder tools/call-Antworten das
      // SDK-Zod-Schema nicht erfüllen (z. B. Google-Pakete mit inputSchema={"$schema": …}),
      // laufen über den rohen JSON-RPC-Client weiter (Bestandsverhalten;  2026-08-19).
      cfg: SessionConfig;
      rawFallback?: StatelessMcpClient;
    }
  | { kind: "stateless"; client: StatelessMcpClient; timeoutMs: number };

export interface SessionConfig {
  server: ServerWithConfig;
  headers: Record<string, string>;
  envVars: Record<string, string>;
}

function buildSdkTransport(server: ServerWithConfig, headers: Record<string, string>, envVars: Record<string, string>) {
  const overrides = server as ServerConfigOverrides;
  const timeoutMs = (overrides.connect_timeout_s ?? 30) * 1000;
  const dispatcher = buildDispatcher(server);

  // B.3: Fehler statt Stille — unbekannter Transport wirft (vorher: stiller HTTP-Fallback)
  const transportType = server.transport_type;
  if (!["stdio", "sse", "http", "streamable_http"].includes(transportType)) {
    throw new Error(`Unbekannter MCP-Transport-Typ: "${transportType}" (erlaubt: stdio, sse, http, streamable_http)`);
  }

  if (transportType === "stdio") {
    const isWinNpx = process.platform === "win32" && server.endpoint_or_command === "npx";
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...envVars })) {
      if (typeof v === "string") env[k] = v;
    }
    return new StdioClientTransport({
      command: isWinNpx ? "cmd" : server.endpoint_or_command,
      args: isWinNpx ? ["/c", "npx", ...(server.command_args || [])] : server.command_args || [],
      env,
      // stderr: "pipe" OHNE Konsument = Deadlock (Puffer voll → Prozess hängt,  Live-Check 2026-08-19)
      stderr: "inherit"
    });
  }

  const url = new URL(server.endpoint_or_command);
  const requestInit: RequestInit & { dispatcher?: unknown } = { headers };
  if (dispatcher) requestInit.dispatcher = dispatcher;

  if (transportType === "sse") {
    return new SSEClientTransport(url, { requestInit });
  }
  // http + streamable_http → Streamable HTTP (B.3: streamable_http ist der moderne Standard-Transport)
  return new StreamableHTTPClientTransport(url, { requestInit });
}

function buildStatelessClient(server: ServerWithConfig, headers: Record<string, string>, envVars: Record<string, string>): StatelessMcpClient {
  const overrides = server as ServerConfigOverrides;
  return new StatelessMcpClient({
    endpoint: server.endpoint_or_command,
    args: server.command_args || [],
    headers,
    envVars,
    timeoutMs: (overrides.connect_timeout_s ?? 30) * 1000,
    dispatcher: buildDispatcher(server)
  });
}

/**
 * Session öffnen mit Protokoll-Negotiation (auto/stateless/legacy):
 * - auto (Default): SDK/initialize zuerst → bei -32022/-32601 Fallback server/discover (stateless)
 * - stateless: server/discover zuerst (ein Legacy-Retry bei Fehler)
 * - legacy: nur Handshake, kein Fallback
 */
export async function openSession(cfg: SessionConfig): Promise<McpSessionHandle> {
  const mode = String(cfg.server.protocol ?? "auto").toLowerCase().trim();
  // stdio-Default 120 s: der ERSTE npx-Download (frischer Cache auf jedem System) lädt große
  // Pakete (googleapis etc.) — mit Cache (persistentes Volume) sind Folge-Sessions schnell;
  // http/sse 30 s. Beide Admin-konfigurierbar via connect_timeout_s (Regel 12).
  const timeoutMs =
    ((cfg.server.connect_timeout_s ?? (cfg.server.transport_type === "stdio" ? 120 : 30)) as number) * 1000;

  if (mode === "stateless" || mode === "modern" || mode === "2026-07-28") {
    try {
      const client = buildStatelessClient(cfg.server, cfg.headers, cfg.envVars);
      const discover = await client.request("server/discover");
      if (!discover.error) return { kind: "stateless", client, timeoutMs };
      // Ein Legacy-Retry
      client.close();
    } catch {
      /* Fallback auf SDK unten */
    }
    return openSdk(cfg);
  }

  if (mode === "legacy" || mode === "handshake") {
    return openSdk(cfg);
  }

  // auto
  try {
    return await openSdk(cfg);
  } catch (err) {
    if (isUnsupportedProtocolError(err) || isMethodNotFoundError(err)) {
      const client = buildStatelessClient(cfg.server, cfg.headers, cfg.envVars);
      const discover = await client.request("server/discover");
      if (discover.error) {
        client.close();
        throw err; // Originalfehler
      }
      return { kind: "stateless", client, timeoutMs };
    }
    throw err;
  }
}

async function openSdk(cfg: SessionConfig): Promise<McpSessionHandle> {
  const overrides = cfg.server as ServerConfigOverrides;
  // stdio-Default 120 s (erster npx-Download), http/sse 30 s — identisch zu openSession
  const timeoutMs =
    ((overrides.connect_timeout_s ?? (cfg.server.transport_type === "stdio" ? 120 : 30)) as number) * 1000;
  const transport = buildSdkTransport(cfg.server, cfg.headers, cfg.envVars);
  const client = new Client({ name: "louis-smart-crm", version: "1.0.0" });
  // Hard-Timeout um connect (initialize): das SDK-RequestOptions.timeout greift bei stdio
  // nicht zuverlässig — ein nie antwortender Server darf den Call nicht ewig blocken.
  await Promise.race([
    client.connect(transport, { timeout: timeoutMs }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP-Session-Öffnung nach ${timeoutMs / 1000}s abgebrochen (${cfg.server.server_name})`)), timeoutMs))
  ]);
  return { kind: "sdk", client, transport, timeoutMs, cfg };
}

// --- Session-Operationen -------------------------------------------------------

// Kompatibilitäts-Fallback: SDK-Zod-Schema-Verletzungen (z. B. Google-Pakete mit
// inputSchema={"$schema": …} ohne type/properties) → roher JSON-RPC-Client (Bestandsverhalten).
function isSchemaValidationError(text: string): boolean {
  return /invalid_value|zoderror|expected object|is not a valid|response is not valid/i.test(text);
}

async function ensureRawFallback(handle: Extract<McpSessionHandle, { kind: "sdk" }>): Promise<StatelessMcpClient> {
  if (!handle.rawFallback) {
    const server = handle.cfg.server as ServerWithConfig;
    const raw = buildStatelessClient(server, handle.cfg.headers, handle.cfg.envVars);
    // initialize (2025-03-26 — ältere Pakete) VOR tools/list; Fehler sind dann echt.
    const init = await raw.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "louis-smart-crm", version: "1.0.0" }
    });
    if (init.error) {
      raw.close();
      throw new Error(`Kompatibilitäts-Modus fehlgeschlagen (initialize): ${init.error.message}`);
    }
    handle.rawFallback = raw;
  }
  return handle.rawFallback;
}

export async function sessionListTools(handle: McpSessionHandle): Promise<Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }>> {
  if (handle.kind === "stateless") {
    const { tools, error } = await handle.client.listTools();
    if (error) throw new Error(error);
    return tools;
  }
  try {
    const res = await handle.client.listTools(undefined, { timeout: handle.timeoutMs });
    return res.tools as Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }>;
  } catch (err) {
    const text = errText(err);
    if (!isSchemaValidationError(text)) throw err;
    const raw = await ensureRawFallback(handle);
    const { tools, error } = await raw.listTools();
    if (error) throw new Error(error);
    return tools;
  }
}

export async function sessionCallTool(
  handle: McpSessionHandle,
  name: string,
  args: unknown
): Promise<{ content?: unknown; isError?: boolean; error?: string; timedOut?: boolean }> {
  if (handle.kind === "stateless") {
    return handle.client.callTool(name, args);
  }
  try {
    // Hard-Timeout (SDK-RequestOptions.timeout greift bei SSE-Streaming nicht zuverlässig,
    // Muster mcp.py:186 AbortController). timedOut-Flag → Engine invalidiert die Session.
    let timedOut = false;
    const callPromise = handle.client.callTool(
      { name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: handle.timeoutMs }
    );
    const timeoutPromise = new Promise<Awaited<typeof callPromise>>((_resolve, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Timeout nach ${handle.timeoutMs}ms`));
      }, handle.timeoutMs);
    });
    const res = await Promise.race([callPromise, timeoutPromise]);
    return { content: res.content, isError: res.isError === true, timedOut };
  } catch (err) {
    const text = errText(err);
    if (isSchemaValidationError(text)) {
      const raw = await ensureRawFallback(handle);
      return raw.callTool(name, args);
    }
    return { error: text, timedOut: /timeout|timed out|abort/i.test(text) };
  }
}

export async function sessionPing(handle: McpSessionHandle): Promise<{ ok: boolean; error?: string }> {
  if (handle.kind === "stateless") {
    return handle.client.ping();
  }
  try {
    // Hard-Timeout wie bei callTool: Server ohne ping-Handler (ältere Pakete) antworten
    // nie — ohne Race hängt der Ping ewig (SDK-RequestOptions.timeout greift bei stdio nicht).
    await Promise.race([
      handle.client.ping({ timeout: handle.timeoutMs }),
      new Promise<never>((_r, reject) => setTimeout(() => reject(new Error(`ping-Timeout nach ${handle.timeoutMs}ms`)), handle.timeoutMs))
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

export async function sessionClose(handle: McpSessionHandle): Promise<void> {
  if (handle.kind === "stateless") {
    handle.client.close();
    return;
  }
  try {
    await handle.client.close();
  } catch {
    /* close ist best-effort */
  }
  // Kompatibilitäts-Fallback-Prozess ebenfalls beenden (kein Prozess-Leak)
  if (handle.rawFallback) {
    handle.rawFallback.close();
    handle.rawFallback = undefined;
  }
}
