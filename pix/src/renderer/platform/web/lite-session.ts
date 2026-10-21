/**
 * Lightweight browser/Android agent session.
 *
 * Does NOT port Electron SessionBridge / pi-coding-agent. It streams chat against
 * OpenAI-compatible or Anthropic HTTP APIs, and implements pdf_read_pages /
 * pdf_outline with pdf.js in the WebView.
 */
import type {
  AgentMessage,
  AgentSessionEvent,
  AuthStatusMap,
  ClipboardImage,
  ModelInfo,
  RpcCommand,
  RpcSessionState,
  SessionInfo,
  SessionStats,
  ThinkingLevel,
} from "@shared/types";
import { READING_ASSISTANT_SYSTEM_PROMPT } from "@shared/reading-prompt";
import { readFile } from "./virtual-library";
import { readPdfOutline, readPdfPages } from "./pdf-extract";
import { kvGet, kvSet, workspaceKey } from "./kv";

type Listener<T> = (payload: T) => void;

const CURATED_MODELS: ModelInfo[] = [
  { provider: "openai", id: "gpt-4o-mini", contextWindow: 128000, input: ["text", "image"] },
  { provider: "openai", id: "gpt-4o", contextWindow: 128000, input: ["text", "image"], reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-4-5", contextWindow: 200000, input: ["text", "image"], reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5", contextWindow: 200000, input: ["text", "image"] },
  { provider: "google", id: "gemini-2.5-flash", contextWindow: 1000000, input: ["text", "image"] },
  { provider: "deepseek", id: "deepseek-chat", contextWindow: 64000, input: ["text"] },
  { provider: "moonshot", id: "moonshot-v1-auto", contextWindow: 128000, input: ["text"] },
];

const PROVIDER_BASE: Record<string, { kind: "openai" | "anthropic" | "google"; url: string }> = {
  openai: { kind: "openai", url: "https://api.openai.com/v1/chat/completions" },
  anthropic: { kind: "anthropic", url: "https://api.anthropic.com/v1/messages" },
  google: { kind: "google", url: "https://generativelanguage.googleapis.com/v1beta/models" },
  deepseek: { kind: "openai", url: "https://api.deepseek.com/chat/completions" },
  moonshot: { kind: "openai", url: "https://api.moonshot.cn/v1/chat/completions" },
};

interface StoredSession {
  info: SessionInfo;
  messages: AgentMessage[];
}

interface AuthMap {
  [provider: string]: string;
}

function authKey(): string {
  return "auth-keys";
}

function sessionsKey(cwd: string): string {
  return workspaceKey(cwd, "sessions");
}

function loadAuth(): AuthMap {
  return kvGet<AuthMap>(authKey(), {});
}

function saveAuth(map: AuthMap): void {
  kvSet(authKey(), map);
}

function loadSessions(cwd: string): StoredSession[] {
  return kvGet<StoredSession[]>(sessionsKey(cwd), []);
}

function saveSessions(cwd: string, sessions: StoredSession[]): void {
  kvSet(sessionsKey(cwd), sessions);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStats(session: StoredSession | null): SessionStats {
  return {
    sessionFile: session?.info.path,
    sessionId: session?.info.id ?? "",
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: session?.messages.length ?? 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

export class LiteSession {
  private cwd: string | null = null;
  private running = false;
  private streaming = false;
  private abort: AbortController | null = null;
  private current: StoredSession | null = null;
  private model: { provider: string; id: string } | null = null;
  private thinkingLevel: ThinkingLevel = "off";
  private readonly eventListeners = new Set<Listener<AgentSessionEvent>>();
  private readonly readyListeners = new Set<Listener<void>>();
  private readonly exitListeners = new Set<Listener<{ code: number | null; signal: string | null; stderr: string }>>();
  private readonly errorListeners = new Set<Listener<{ message: string }>>();

  onEvent(cb: Listener<AgentSessionEvent>): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }
  onReady(cb: Listener<void>): () => void {
    this.readyListeners.add(cb);
    return () => this.readyListeners.delete(cb);
  }
  onExit(cb: Listener<{ code: number | null; signal: string | null; stderr: string }>): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
  onError(cb: Listener<{ message: string }>): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  private emit(event: AgentSessionEvent): void {
    for (const cb of this.eventListeners) cb(event);
  }

  async start(projectDir: string): Promise<{ success: boolean; error?: string }> {
    this.cwd = projectDir;
    this.running = true;
    const auth = loadAuth();
    const settingsModel = kvGet<{ provider?: string; modelId?: string }>("default-model", {});
    if (settingsModel.provider && settingsModel.modelId) {
      this.model = { provider: settingsModel.provider, id: settingsModel.modelId };
    } else {
      const firstConfigured = CURATED_MODELS.find((m) => Boolean(auth[m.provider]));
      this.model = firstConfigured ? { provider: firstConfigured.provider, id: firstConfigured.id } : null;
    }
    queueMicrotask(() => {
      for (const cb of this.readyListeners) cb();
    });
    return { success: true };
  }

  async stop(): Promise<{ success: boolean }> {
    this.abort?.abort();
    this.abort = null;
    this.streaming = false;
    this.running = false;
    this.current = null;
    this.cwd = null;
    for (const cb of this.exitListeners) cb({ code: 0, signal: null, stderr: "" });
    return { success: true };
  }

  isRunning(): boolean {
    return this.running;
  }

  listSessions(projectDir: string): SessionInfo[] {
    return loadSessions(projectDir).map((s) => s.info);
  }

  deleteSession(sessionPath: string, projectDir?: string): { success: boolean; error?: string } {
    const cwd = projectDir ?? this.cwd;
    if (!cwd) return { success: false, error: "No workspace." };
    const sessions = loadSessions(cwd).filter((s) => s.info.path !== sessionPath);
    saveSessions(cwd, sessions);
    if (this.current?.info.path === sessionPath) this.current = null;
    return { success: true };
  }

  getState(): RpcSessionState {
    return {
      model: this.model ?? undefined,
      thinkingLevel: this.thinkingLevel,
      isStreaming: this.streaming,
      isCompacting: false,
      executionMode: "read-only",
      steeringMode: "all",
      followUpMode: "all",
      sessionFile: this.current?.info.path,
      sessionId: this.current?.info.id ?? "",
      sessionName: this.current?.info.name,
      autoCompactionEnabled: false,
      messageCount: this.current?.messages.length ?? 0,
      pendingMessageCount: 0,
    };
  }

  async handle(command: RpcCommand): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      switch (command.type) {
        case "get_state":
          return { success: true, data: this.getState() };
        case "get_available_models":
          return { success: true, data: { models: CURATED_MODELS } };
        case "get_commands":
          return { success: true, data: { commands: [] } };
        case "get_session_stats":
          return { success: true, data: emptyStats(this.current) };
        case "get_messages":
          return { success: true, data: this.current?.messages ?? [] };
        case "get_available_thinking_levels":
          return { success: true, data: { levels: ["off", "low", "medium", "high"] satisfies ThinkingLevel[] } };
        case "supports_thinking":
          return { success: true, data: { supported: Boolean(this.model) } };
        case "set_thinking_level":
          this.thinkingLevel = command.level;
          this.emit({ type: "thinking_level_changed", level: command.level });
          return { success: true, data: { level: command.level } };
        case "cycle_thinking_level":
          return { success: true, data: { level: this.thinkingLevel } };
        case "set_model":
          this.model = { provider: command.provider, id: command.modelId };
          kvSet("default-model", { provider: command.provider, modelId: command.modelId });
          return { success: true, data: { model: this.model } };
        case "get_auth_status": {
          const auth = loadAuth();
          const status: AuthStatusMap = {};
          for (const m of CURATED_MODELS) {
            if (status[m.provider]) continue;
            status[m.provider] = {
              provider: m.provider,
              configured: Boolean(auth[m.provider]),
              source: auth[m.provider] ? "stored" : undefined,
            };
          }
          return { success: true, data: status };
        }
        case "set_api_key": {
          const auth = loadAuth();
          auth[command.provider] = command.key.trim();
          saveAuth(auth);
          return { success: true };
        }
        case "remove_auth":
        case "logout": {
          const auth = loadAuth();
          delete auth[command.provider];
          saveAuth(auth);
          return { success: true };
        }
        case "login":
          return { success: false, error: "OAuth login is not available on Android/web. Use an API key." };
        case "new_session":
          return { success: true, data: this.newSession() };
        case "switch_session":
          return { success: true, data: this.switchSession(command.sessionPath) };
        case "set_session_name":
          if (this.current) {
            this.current.info.name = command.name;
            this.persistCurrent();
            this.emit({ type: "session_info_changed", name: command.name });
          }
          return { success: true };
        case "prompt":
        case "steer":
        case "follow_up":
          await this.runPrompt(command.message, command.images);
          return { success: true };
        case "abort":
          this.abort?.abort();
          this.abort = null;
          this.streaming = false;
          return { success: true };
        case "get_pi_settings":
          return { success: true, data: {} };
        case "set_pi_setting":
        case "set_pi_settings":
        case "reload_resources":
          return { success: true };
        case "get_resource_status":
          return { success: true, data: { extensions: { loaded: 0, errors: [] }, skills: { loaded: 0 }, prompts: { loaded: 0 } } };
        case "get_last_assistant_text": {
          const last = [...(this.current?.messages ?? [])].reverse().find((m) => m.role === "assistant");
          const text =
            typeof last?.content === "string"
              ? last.content
              : Array.isArray(last?.content)
                ? last.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("")
                : "";
          return { success: true, data: { text } };
        }
        default:
          return { success: false, error: `Unsupported on Android/web lite session: ${command.type}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const cb of this.errorListeners) cb({ message });
      return { success: false, error: message };
    }
  }

  private newSession(): { sessionFile: string; sessionId: string } {
    if (!this.cwd) throw new Error("No workspace.");
    const id = makeId("sess");
    const path = `${this.cwd}/.pix-read/sessions/${id}.json`;
    const now = new Date().toISOString();
    const stored: StoredSession = {
      info: {
        path,
        id,
        cwd: this.cwd,
        created: now,
        modified: now,
        messageCount: 0,
        firstMessage: "",
      },
      messages: [],
    };
    const sessions = loadSessions(this.cwd);
    sessions.unshift(stored);
    saveSessions(this.cwd, sessions);
    this.current = stored;
    return { sessionFile: path, sessionId: id };
  }

  private switchSession(sessionPath: string): { sessionFile: string; sessionId: string } {
    if (!this.cwd) throw new Error("No workspace.");
    const found = loadSessions(this.cwd).find((s) => s.info.path === sessionPath);
    if (!found) throw new Error("Session not found.");
    this.current = found;
    return { sessionFile: found.info.path, sessionId: found.info.id };
  }

  private persistCurrent(): void {
    if (!this.cwd || !this.current) return;
    const sessions = loadSessions(this.cwd);
    const idx = sessions.findIndex((s) => s.info.path === this.current?.info.path);
    this.current.info.modified = new Date().toISOString();
    this.current.info.messageCount = this.current.messages.length;
    if (idx >= 0) sessions[idx] = this.current;
    else sessions.unshift(this.current);
    saveSessions(this.cwd, sessions);
  }

  private async runPrompt(message: string, images?: ClipboardImage[]): Promise<void> {
    if (!this.cwd) throw new Error("No workspace.");
    if (!this.current) this.newSession();
    if (!this.model) throw new Error("未配置模型：请先在设置中填写 API Key 并选择模型。");
    const auth = loadAuth();
    const apiKey = auth[this.model.provider];
    if (!apiKey) throw new Error(`未配置 ${this.model.provider} 的 API Key。`);

    const userMsg: AgentMessage = {
      role: "user",
      content: message,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    };
    this.current!.messages.push(userMsg);
    if (!this.current!.info.firstMessage) {
      this.current!.info.firstMessage = message.slice(0, 80);
    }
    this.persistCurrent();

    this.streaming = true;
    this.abort = new AbortController();
    this.emit({ type: "agent_start" });
    this.emit({ type: "turn_start" });
    this.emit({ type: "message_start", message: userMsg });
    this.emit({ type: "message_end", message: userMsg });

    const assistantId = makeId("asst");
    let assistantText = "";
    const assistantMsg: AgentMessage = { role: "assistant", content: "", id: assistantId };
    this.emit({ type: "message_start", message: assistantMsg });

    try {
      const toolTrace = await this.maybeRunPdfTools(message);
      const system = [
        READING_ASSISTANT_SYSTEM_PROMPT,
        "",
        "You are running inside the PiX-Read Android/web lite runtime.",
        "MCP, coding tools, and the full Electron SessionBridge are unavailable.",
        toolTrace ? `Tool results already gathered for this turn:\n${toolTrace}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      assistantText = await this.streamLlm({
        system,
        history: this.current!.messages.slice(0, -1),
        userText: message,
        images,
        signal: this.abort.signal,
        onDelta: (delta) => {
          assistantText += delta;
          const partial: AgentMessage = { role: "assistant", content: assistantText, id: assistantId };
          this.emit({ type: "message_update", message: partial });
        },
      });

      const finalMsg: AgentMessage = { role: "assistant", content: assistantText, id: assistantId };
      this.current!.messages.push(finalMsg);
      this.persistCurrent();
      this.emit({ type: "message_end", message: finalMsg });
      this.emit({ type: "turn_end", message: finalMsg, toolResults: [] });
      this.emit({ type: "agent_end", messages: this.current!.messages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as { name?: string })?.name !== "AbortError") {
        for (const cb of this.errorListeners) cb({ message: msg });
        this.emit({
          type: "message_end",
          message: { role: "assistant", content: assistantText || `错误：${msg}`, id: assistantId },
        });
        this.emit({ type: "agent_end", messages: this.current?.messages ?? [] });
      }
    } finally {
      this.streaming = false;
      this.abort = null;
    }
  }

  private async maybeRunPdfTools(message: string): Promise<string> {
    if (!this.cwd) return "";
    const pathMatch = message.match(/(\/pix-library\/[^\s"'<>]+\.pdf)/i);
    // Prefer explicit path in message; otherwise leave tools unused (UI injects reading_context).
    const filePath = pathMatch?.[1];
    if (!filePath) {
      // Heuristic: if user asks to summarize/read and reading_context embeds a path.
      const ctxPath = message.match(/document(?:Path|):\s*([^\n]+)/i)?.[1]?.trim();
      if (!ctxPath?.toLowerCase().endsWith(".pdf")) return "";
      return this.runPdfToolBundle(ctxPath, message);
    }
    return this.runPdfToolBundle(filePath, message);
  }

  private async runPdfToolBundle(filePath: string, message: string): Promise<string> {
    if (!this.cwd) return "";
    const file = await readFile(this.cwd, filePath);
    if (!file.success || !file.data) return `pdf tool failed: ${file.error ?? "read failed"}`;
    const toolCallId = makeId("tool");
    this.emit({
      type: "tool_execution_start",
      toolCallId,
      toolName: "pdf_read_pages",
      args: { filePath },
    });
    const pageMatch = message.match(/\[\[p(\d+)\]\]|第\s*(\d+)\s*页|page\s*(\d+)/i);
    const page = Number(pageMatch?.[1] || pageMatch?.[2] || pageMatch?.[3] || 1);
    const start = Math.max(1, page);
    const end = start + 2;
    const pages = await readPdfPages(file.data, start, end);
    const outline = await readPdfOutline(file.data);
    const result = {
      pageCount: pages.pageCount,
      pages: pages.pages,
      outlinePreview: outline.outline.slice(0, 30),
    };
    this.emit({
      type: "tool_execution_end",
      toolCallId,
      toolName: "pdf_read_pages",
      result,
      isError: false,
    });
    return JSON.stringify(result).slice(0, 12000);
  }

  private async streamLlm(args: {
    system: string;
    history: AgentMessage[];
    userText: string;
    images?: ClipboardImage[];
    signal: AbortSignal;
    onDelta: (text: string) => void;
  }): Promise<string> {
    if (!this.model) throw new Error("No model");
    const conf = PROVIDER_BASE[this.model.provider];
    if (!conf) throw new Error(`Unsupported provider: ${this.model.provider}`);
    const apiKey = loadAuth()[this.model.provider];
    if (!apiKey) throw new Error("Missing API key");

    if (conf.kind === "anthropic") {
      return this.streamAnthropic(conf.url, apiKey, args);
    }
    if (conf.kind === "google") {
      return this.streamGoogle(conf.url, apiKey, args);
    }
    return this.streamOpenAiCompat(conf.url, apiKey, args);
  }

  private historyText(history: AgentMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of history) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("")
            : "";
      if (!text) continue;
      out.push({ role: m.role, content: text });
    }
    return out.slice(-12);
  }

  private async streamOpenAiCompat(
    url: string,
    apiKey: string,
    args: {
      system: string;
      history: AgentMessage[];
      userText: string;
      signal: AbortSignal;
      onDelta: (text: string) => void;
    },
  ): Promise<string> {
    const messages = [
      { role: "system", content: args.system },
      ...this.historyText(args.history),
      { role: "user", content: args.userText },
    ];
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model!.id,
        messages,
        stream: true,
        temperature: 0.3,
      }),
      signal: args.signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    return this.consumeSse(res.body, args.onDelta, (json) => {
      const choices = json.choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
      const delta = (choices[0] as { delta?: { content?: unknown } }).delta?.content;
      return typeof delta === "string" ? delta : "";
    });
  }

  private async streamAnthropic(
    url: string,
    apiKey: string,
    args: {
      system: string;
      history: AgentMessage[];
      userText: string;
      signal: AbortSignal;
      onDelta: (text: string) => void;
    },
  ): Promise<string> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model!.id,
        max_tokens: 4096,
        system: args.system,
        stream: true,
        messages: [
          ...this.historyText(args.history).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: args.userText },
        ],
      }),
      signal: args.signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    return this.consumeSse(res.body, args.onDelta, (json) => {
      if (json.type !== "content_block_delta") return "";
      const delta = json.delta;
      if (!delta || typeof delta !== "object") return "";
      const d = delta as { type?: unknown; text?: unknown };
      if (d.type !== "text_delta") return "";
      return typeof d.text === "string" ? d.text : "";
    });
  }

  private async streamGoogle(
    base: string,
    apiKey: string,
    args: {
      system: string;
      history: AgentMessage[];
      userText: string;
      signal: AbortSignal;
      onDelta: (text: string) => void;
    },
  ): Promise<string> {
    const url = `${base}/${encodeURIComponent(this.model!.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const contents = [
      ...this.historyText(args.history).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      { role: "user", parts: [{ text: args.userText }] },
    ];
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents,
      }),
      signal: args.signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Google HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    return this.consumeSse(res.body, args.onDelta, (json) => {
      const candidates = json.candidates;
      if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return "";
      const content = (candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } }).content;
      const text = content?.parts?.[0]?.text;
      return typeof text === "string" ? text : "";
    });
  }

  private async consumeSse(
    body: ReadableStream<Uint8Array>,
    onDelta: (text: string) => void,
    pick: (json: Record<string, unknown>) => string,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() ?? "";
      for (const line of chunks) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as Record<string, unknown>;
          const delta = pick(json);
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // ignore partial JSON
        }
      }
    }
    return full;
  }
}
