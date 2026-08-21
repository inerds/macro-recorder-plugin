import { useEffect, useState } from "react";

import { trace, type TraceStatus } from "./trace";

/**
 * Dev-only diagnostics bar. Unlike DebugStrip (which needs mock gateways and
 * therefore only exists when the sandbox handshake FAILS), this renders in
 * both modes — including inside Creator with the real engine, which is exactly
 * where traces matter.
 */
export function TraceStrip({ kind }: { kind: "rpc" | "mock" }) {
  const [status, setStatus] = useState<TraceStatus>(() => trace.status());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => trace.onChange(setStatus), []);

  if (!trace.enabled) return null;

  async function copy() {
    const json = trace.asJson("manual");
    try {
      await navigator.clipboard.writeText(json);
      setCopied("copied");
    } catch {
      // Opaque-origin iframes usually deny the clipboard — fall back to the
      // console, which devtools can copy from.
      console.log("[macro-recorder] trace bundle:\n" + json);
      setCopied("logged to console");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  const label = status.lastError
    ? `trace offline (${status.lastError})`
    : status.lastWrite
      ? `wrote ${status.lastWrite}`
      : "no trace written yet";

  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-2 py-1 text-10 text-muted-foreground">
      <span
        className={`inline-block size-1.5 rounded-full ${
          status.lastError ? "bg-destructive" : "bg-emerald-500"
        }`}
        aria-hidden
      />
      <span className="font-medium">{kind === "rpc" ? "engine" : "mock"}</span>
      <span>{status.events} events</span>
      {status.dropped > 0 && <span>({status.dropped} dropped)</span>}
      <span className="truncate" title={label}>
        {label}
      </span>
      <div className="ml-auto flex gap-1">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          onClick={() => void trace.flush("manual")}
        >
          Flush
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          onClick={() => void copy()}
        >
          {copied ?? "Copy"}
        </button>
      </div>
    </div>
  );
}
