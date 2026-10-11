// CLINICOS CONNECT (C3) — the browser side of the realtime connection: Socket.IO client + reconnect policy. No React, no React Query.
//
//  • Authenticated with the SAME Bearer token as every API call (read fresh on EVERY (re)connect, so a renewed token is picked up).
//  • Reconnects by itself with exponential back-off + jitter (1 s → 15 s). After EVERY (re)connect the owner is told, and reconciles over HTTP:
//    sockets are not durable storage, so nothing is replayed — the database (through the C1 HTTP API) repairs whatever was missed.
//  • A refusal that will not change by retrying (not signed in, role, plan, suspended, expired) STOPS the retries; the screens learn it
//    from their HTTP answers (402 / 401) exactly as before.
//  • Browser online/offline and tab visibility are used as hints only (they never decide what is true).
import { io, type Socket } from "socket.io-client";
import { RT_CLIENT, RT_EVENTS, socketTransports, socketUrl } from "./config";
import type { RtStatus } from "./store";

const TERMINAL = new Set(["UNAUTHORIZED", "FORBIDDEN_ROLE", "PLAN_LIMIT", "SUSPENDED", "EXPIRED"]);

export interface ConnectSocketOptions {
  getToken: () => string | null;
  onStatus: (status: RtStatus, deniedCode?: string | null) => void;
  /** Any `connect:*` server event, still untrusted (the owner validates the shape). */
  onEvent: (name: string, payload: unknown) => void;
  /** Fired after every successful connection. `again` = this is a RECONNECT (the page already had one before). */
  onConnected: (again: boolean) => void;
  /** The tab came back after a long time hidden while the socket is up. */
  onForeground: () => void;
  /** Is the API itself reachable over HTTP? Asked when a FIRST connection attempt fails, to tell "realtime is unavailable here" (silent HTTP fallback) from "the network is down" (status chip). */
  probe?: () => Promise<boolean>;
  /** Test hook: use another origin / path. */
  url?: string;
}

export class ConnectSocket {
  private socket: Socket;
  private desired = new Set<string>();
  private everConnected = false;
  private stopped = false;
  private denied = false;
  private hiddenAt = 0;
  private manualTimer: ReturnType<typeof setTimeout> | null = null;
  private manualTries = 0;
  private fails = 0;
  private probing = false;
  private unavailable = false;

  constructor(private opts: ConnectSocketOptions) {
    this.socket = io(opts.url ?? socketUrl(), {
      path: "/socket.io",
      autoConnect: false,
      transports: socketTransports(),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
      timeout: 10000,
      auth: (cb) => cb({ token: this.opts.getToken() ?? "" }),
    });
    this.bind();
  }

  private offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

  private bind() {
    const s = this.socket;
    s.on("connect", () => {
      this.manualTries = 0;
      this.fails = 0;
      this.unavailable = false;
      const again = this.everConnected;
      this.everConnected = true;
      this.opts.onStatus("connected");
      this.desired.forEach((id) => this.emitSubscribe(id)); // a new connection starts with no subscriptions
      this.opts.onConnected(again);
    });
    s.on("disconnect", (reason) => {
      if (this.stopped || this.denied) return;
      this.opts.onStatus(this.offline() ? "offline" : "reconnecting");
      // "io server disconnect": the server closed us (deploy / restart / a re-check) — socket.io will NOT retry that one by itself
      if (reason === "io server disconnect") this.scheduleManual();
    });
    s.on("connect_error", (err: Error & { data?: { code?: string } }) => {
      if (this.stopped) return;
      const code = err?.data?.code;
      if (code && TERMINAL.has(code)) return this.deny(code);
      this.fails++;
      // a refused handshake that is not terminal (too many tabs, server hiccup): socket.io keeps its own back-off going
      if (this.offline()) return this.opts.onStatus("offline");
      // Never connected on this page and the API answers over HTTP → realtime is simply not available here: stay quiet, polling does the job
      if (!this.everConnected && this.opts.probe && !this.probing && this.fails % 3 === 1) {
        this.probing = true;
        this.opts
          .probe()
          .then((reachable) => {
            if (this.stopped || this.denied || this.socket.connected) return;
            this.unavailable = reachable;
            this.opts.onStatus(reachable ? "unavailable" : this.offline() ? "offline" : "reconnecting");
          })
          .catch(() => this.opts.onStatus("reconnecting"))
          .finally(() => (this.probing = false));
        return;
      }
      if (!this.unavailable && (this.fails > 1 || this.everConnected)) this.opts.onStatus("reconnecting");
    });
    s.onAny((name: string, payload: unknown) => {
      if (typeof name !== "string" || name.indexOf("connect:") !== 0) return;
      if (name === RT_EVENTS.revoked) {
        const code = (payload as { code?: string } | null)?.code;
        return this.deny(typeof code === "string" ? code : "UNAUTHORIZED");
      }
      this.opts.onEvent(name, payload);
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  private deny(code: string) {
    this.denied = true;
    if (this.manualTimer) clearTimeout(this.manualTimer);
    this.socket.disconnect();
    this.opts.onStatus("denied", code);
  }

  private scheduleManual() {
    if (this.manualTimer || this.stopped || this.denied) return;
    const delay = Math.min(1000 * 2 ** this.manualTries++, 15000) * (0.5 + Math.random());
    this.manualTimer = setTimeout(() => {
      this.manualTimer = null;
      if (!this.stopped && !this.denied && !this.socket.connected) this.socket.connect();
    }, delay);
  }

  private onOnline = () => {
    if (this.stopped || this.denied) return;
    this.opts.onStatus(this.socket.connected ? "connected" : "reconnecting");
    if (!this.socket.connected) this.socket.connect(); // do not wait for the back-off timer: the network is back
  };
  private onOffline = () => {
    if (this.stopped || this.denied) return;
    this.opts.onStatus("offline");
  };
  private onVisibility = () => {
    if (this.stopped || this.denied) return;
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }
    const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (!this.socket.connected) this.socket.connect();
    else if (away >= RT_CLIENT.hiddenReconcileMs) this.opts.onForeground();
  };

  start() {
    if (this.stopped) return;
    this.opts.onStatus(this.offline() ? "offline" : "connecting");
    this.socket.connect();
  }

  stop() {
    this.stopped = true;
    if (this.manualTimer) clearTimeout(this.manualTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.desired.clear();
  }

  private emitSubscribe(id: string) {
    if (!this.socket.connected) return;
    this.socket.timeout(5000).emit(RT_EVENTS.subscribe, { conversationId: id }, (err: unknown, res?: { ok?: boolean; code?: string }) => {
      // the server said no (not a member / no longer exists): stop asking for it
      if (!err && res && res.ok === false && (res.code === "NOT_FOUND" || res.code === "INVALID_ID")) this.desired.delete(id);
    });
  }

  /** Ask the server to relay typing for this conversation (it verifies membership; we re-ask after every reconnect). */
  subscribe(id: string) {
    this.desired.add(id);
    this.emitSubscribe(id);
  }

  unsubscribe(id: string) {
    this.desired.delete(id);
    if (this.socket.connected) this.socket.emit(RT_EVENTS.unsubscribe, { conversationId: id });
  }

  /** Ephemeral typing signal. Dropped when not connected (typing is never worth a retry). */
  typing(id: string, typing: boolean) {
    if (this.socket.connected) this.socket.emit(RT_EVENTS.typing, { conversationId: id, typing });
  }

  get connected() {
    return this.socket.connected;
  }
}
