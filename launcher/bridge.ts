// In-process bridge between the MCP server and the app page.
//
// Everything the MCP tools operate on — AI/AO values, Parameter channels, the
// Pyodide ScriptRunner, the Modbus connection — lives in the browser page, not
// in this process. The page opens a WebSocket back to the launcher's own app
// server (same origin, see server.ts) and this module relays request/response
// pairs over it.
//
// The launcher never talks Modbus itself: every write ends up calling the same
// page-side callbacks the ScriptRunner uses, so the transfer mutex and minimum
// message interval in webserialClient keep applying unchanged.
export const BRIDGE_PATH_SUFFIX = '__bridge';

// Structural subset of Bun's ServerWebSocket, so this module needs no Bun type
// package (the launcher is compiled by Bun, not typechecked by tsc).
type BridgeSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

const DEFAULT_TIMEOUT_MS = 3000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Response frame sent by the page. `id` matches the request; exactly one of
// `result` / `error` is present.
type BridgeResponse = {
  id?: number;
  result?: unknown;
  error?: string;
};

// What the page is told about the MCP endpoint as soon as it connects, so the
// UI can show whether MCP is actually reachable (and on which URL) without
// having to guess — a second instance runs with `enabled: false`.
export type McpEndpointInfo = { enabled: boolean; url: string | null };

class Bridge {
  // Only one page is ever attached: the launcher opens exactly one window, and
  // a second connection attempt is refused (first wins) so a stray tab cannot
  // hijack the MCP session.
  private socket: BridgeSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private endpoint: McpEndpointInfo = { enabled: false, url: null };

  get connected(): boolean {
    return this.socket !== null;
  }

  setEndpointInfo(info: McpEndpointInfo): void {
    this.endpoint = info;
  }

  // Returns false when a page is already attached, so the caller can refuse the
  // upgrade instead of silently replacing the live connection.
  attach(socket: BridgeSocket): boolean {
    if (this.socket) return false;
    this.socket = socket;
    socket.send(JSON.stringify({ type: 'hello', mcp: this.endpoint }));
    return true;
  }

  detach(socket: BridgeSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.failAllPending('The app window disconnected.');
  }

  handleMessage(raw: string): void {
    let response: BridgeResponse;
    try {
      response = JSON.parse(raw) as BridgeResponse;
    } catch {
      return;
    }
    if (typeof response.id !== 'number') return;
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error !== undefined) entry.reject(new Error(response.error));
    else entry.resolve(response.result);
  }

  // Send a method call to the page and wait for its response. Rejects (rather
  // than hanging) when no page is attached or the page does not answer in time.
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const socket = this.socket;
    if (!socket) {
      return Promise.reject(
        new Error('The Modbus Simple Logger window is not connected. Is the app still open?'),
      );
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The app window did not respond to "${method}" within ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  private failAllPending(message: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export const bridge = new Bridge();
