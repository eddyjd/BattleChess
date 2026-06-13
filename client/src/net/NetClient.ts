import {
  type ClientMessage,
  type ServerMessage,
  encode,
  decode,
} from "../../../shared/protocol";

type Handler = (msg: ServerMessage) => void;

/**
 * Thin WebSocket wrapper for online play. Auto-derives the server URL from
 * the page origin (works behind the Vite dev proxy and in production where
 * the same server hosts the client).
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private pingTimer: number | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.pingTimer = window.setInterval(() => this.send({ t: "ping" }), 25_000);
        resolve();
      };
      ws.onerror = () => reject(new Error("Could not reach the game server."));
      ws.onclose = () => {
        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.emit({ t: "error", message: "Disconnected from server." });
      };
      ws.onmessage = (e) => {
        const msg = decode<ServerMessage>(typeof e.data === "string" ? e.data : "");
        if (msg) this.emit(msg);
      };
    });
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(msg: ServerMessage): void {
    for (const h of this.handlers) h(msg);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}
