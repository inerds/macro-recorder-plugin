/**
 * Dev-only diagnostics log.
 *
 * Collects an ordered event stream (every RPC in both directions, recorded
 * steps, playback outcomes) and POSTs it to the Vite dev server, which writes
 * it to `traces/`. Inside Creator the UI runs in a sandboxed opaque-origin
 * iframe: localStorage throws and Blob downloads may be blocked, but plain
 * fetch to the dev server works, and @lottiefiles/vite-plugin-creator already
 * enables CORS on that server. See scripts/trace-server.ts.
 *
 * Everything here no-ops unless import.meta.env.DEV.
 */

export const TRACE_ENDPOINT = "/__macro-trace";

/** Keeps a long session from growing without bound. */
const MAX_EVENTS = 5000;

export type TraceEventKind =
  | "rpc-request"
  | "rpc-response"
  | "rpc-notify"
  | "rpc-error"
  | "step-recorded"
  | "playback-event"
  | "note";

export interface TraceEvent {
  seq: number;
  /** Milliseconds since the trace session started. */
  t: number;
  kind: TraceEventKind;
  data: unknown;
}

export interface TraceBundle {
  version: 1;
  label: string;
  startedAt: number;
  endedAt: number;
  env: Record<string, unknown>;
  dropped: number;
  events: TraceEvent[];
}

export interface TraceStatus {
  events: number;
  dropped: number;
  lastWrite: string | null;
  lastError: string | null;
}

function describeEnv(): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  try {
    env.inIframe = window.self !== window.top;
  } catch {
    // cross-origin access throws — that itself means we are framed
    env.inIframe = true;
  }
  try {
    env.href = window.location.href;
    env.origin = window.location.origin;
  } catch {
    // opaque origin
  }
  try {
    env.userAgent = navigator.userAgent;
  } catch {
    // ignore
  }
  return env;
}

class TraceRecorder {
  readonly enabled: boolean;
  private events: TraceEvent[] = [];
  private seq = 0;
  private dropped = 0;
  private startedAt = Date.now();
  private lastWrite: string | null = null;
  private lastError: string | null = null;
  private listeners = new Set<(status: TraceStatus) => void>();
  /** Extra context merged into the bundle's env block. */
  private context: Record<string, unknown> = {};
  /** Serializes flushes — an overlap would double-send or over-trim events. */
  private flushChain: Promise<string | null> = Promise.resolve(null);

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  setContext(context: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.context = { ...this.context, ...context };
  }

  event(kind: TraceEventKind, data: unknown): void {
    if (!this.enabled) return;
    this.events.push({
      seq: this.seq++,
      t: Date.now() - this.startedAt,
      kind,
      data,
    });
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
      this.dropped++;
    }
    this.emit();
  }

  status(): TraceStatus {
    return {
      events: this.events.length,
      dropped: this.dropped,
      lastWrite: this.lastWrite,
      lastError: this.lastError,
    };
  }

  onChange(callback: (status: TraceStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  bundle(label: string): TraceBundle {
    return {
      version: 1,
      label,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      env: { ...describeEnv(), ...this.context },
      dropped: this.dropped,
      events: [...this.events],
    };
  }

  /**
   * Writes the current bundle to the dev server and starts a fresh session.
   * Never throws and never blocks the caller: a failed write leaves the events
   * in memory so the DebugStrip can still copy them out. Flushes queue behind
   * one another, so a second call during a write sends only what remains.
   */
  flush(label: string): Promise<string | null> {
    const run = this.flushChain.then(() => this.doFlush(label));
    this.flushChain = run;
    return run;
  }

  private async doFlush(label: string): Promise<string | null> {
    if (!this.enabled || this.events.length === 0) return null;
    // Count what goes into the bundle so only that prefix is trimmed after —
    // events recorded while the POST is in flight (e.g. the playback.end
    // response) belong to the next session and must survive.
    const bundled = this.events.length;
    const bundle = this.bundle(label);
    try {
      const response = await fetch(TRACE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { file?: string };
      this.lastWrite = result.file ?? label;
      this.lastError = null;
      this.events = this.events.slice(bundled);
      this.dropped = 0;
      if (this.events.length === 0) {
        this.seq = 0;
        this.startedAt = Date.now();
      }
      this.emit();
      return this.lastWrite;
    } catch (error) {
      // Dev server unreachable (e.g. testing a deployed build). Keep the
      // events so nothing is lost; the strip offers a copy button.
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emit();
      return null;
    }
  }

  asJson(label = "manual"): string {
    return JSON.stringify(this.bundle(label), null, 2);
  }

  private emit(): void {
    const status = this.status();
    this.listeners.forEach((cb) => cb(status));
  }
}

export const trace = new TraceRecorder(import.meta.env.DEV);
