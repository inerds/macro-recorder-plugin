import {
  isRpcMessage,
  type RpcContracts,
  type RpcMethod,
  type RpcRequest,
} from "../../../engine/protocol";
import { trace } from "../../dev/trace";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
  method: RpcMethod;
  startedAt: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The step-recorded / playback-event trace events already carry the debug
 * payloads (snapshot pairs, target probes); tracing them again on the raw
 * response would double every bundle's size.
 */
function slimResult(result: unknown): unknown {
  if (result !== null && typeof result === "object" && "debug" in result) {
    const { debug: _debug, ...rest } = result as Record<string, unknown>;
    return { ...rest, debug: "(omitted — see step-recorded / playback-event)" };
  }
  return result;
}

/** UI side of the UI<->sandbox RPC: correlation ids, timeouts, notifications. */
export class RpcClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private notifyListeners = new Set<(event: string) => void>();

  constructor() {
    window.addEventListener("message", this.onMessage);
  }

  private onMessage = (event: MessageEvent) => {
    const message: unknown = (event.data as { pluginMessage?: unknown } | null)?.pluginMessage;
    if (!isRpcMessage(message)) return;
    if (message.t === "notify") {
      trace.event("rpc-notify", { event: message.event });
      this.notifyListeners.forEach((cb) => cb(message.event));
      return;
    }
    if (message.t !== "res") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    const ms = Date.now() - pending.startedAt;
    if (message.ok) {
      trace.event("rpc-response", {
        id: message.id,
        method: pending.method,
        ms,
        result: slimResult(message.result),
      });
      pending.resolve(message.result);
    } else {
      trace.event("rpc-error", {
        id: message.id,
        method: pending.method,
        ms,
        error: message.error,
      });
      pending.reject(new Error(message.error));
    }
  };

  call<M extends RpcMethod>(
    method: M,
    params: RpcContracts[M]["params"],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<RpcContracts[M]["result"]> {
    const id = this.nextId++;
    const request: RpcRequest = { t: "req", id, method, params };
    // The handshake retries by design; tracing every failed attempt is noise.
    if (method !== "hello") trace.event("rpc-request", { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        if (method !== "hello") {
          trace.event("rpc-error", { id, method, error: "timeout" });
        }
        reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
        startedAt: Date.now(),
      });
      parent.postMessage({ pluginMessage: request }, "*");
    });
  }

  onNotify(callback: (event: string) => void): () => void {
    this.notifyListeners.add(callback);
    return () => this.notifyListeners.delete(callback);
  }
}
