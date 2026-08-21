import type { RpcMessage, RpcMethod, RpcResponse } from "../shared/protocol";

type Handler = (params: unknown) => unknown | Promise<unknown>;

const handlers = new Map<RpcMethod, Handler>();

export function registerHandler(method: RpcMethod, handler: Handler): void {
  handlers.set(method, handler);
}

function respond(response: RpcResponse): void {
  creator.ui.postMessage(response);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dispatches one request. QUICKJS CONSTRAINT: the host invokes the onMessage
 * callback without pumping the VM job queue afterward, so a pure VM promise
 * chain (e.g. `Promise.resolve().then(...)`) would NEVER run. Synchronous
 * handlers must therefore respond inline, within this same invocation.
 * Async handlers are safe only because they immediately await native-backed
 * promises (creator.clientStorage.*), whose settlement pumps the job queue
 * and drains the .then() continuations below.
 */
export function handleMessage(message: RpcMessage): void {
  if (message.t !== "req") return;
  const { id, method, params } = message;
  const handler = handlers.get(method);
  if (!handler) {
    respond({ t: "res", id, ok: false, error: `unknown method: ${method}` });
    return;
  }

  let result: unknown;
  try {
    result = handler(params);
  } catch (error) {
    respond({ t: "res", id, ok: false, error: errorText(error) });
    return;
  }

  if (
    result !== null &&
    typeof result === "object" &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    (result as Promise<unknown>).then(
      (value) => respond({ t: "res", id, ok: true, result: value ?? null }),
      (error) => respond({ t: "res", id, ok: false, error: errorText(error) }),
    );
    return;
  }

  respond({ t: "res", id, ok: true, result: result ?? null });
}
