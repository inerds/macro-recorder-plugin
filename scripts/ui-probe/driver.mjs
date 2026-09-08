/**
 * A very small headless-Chrome driver, over the DevTools protocol.
 *
 * There is no browser-automation dependency here on purpose: the suite needs
 * six page facts, not a framework, and CDP over Node 22's global `WebSocket`
 * costs nothing to install and nothing to keep current. Chrome is launched
 * once per run; every scenario re-navigates the one page.
 *
 * The helpers come in three layers. The lower one is generic — `navigate`,
 * `click`, `rectOf`, `onTopAt`. The middle one reaches into the host
 * harness's panel FRAME — `navigateHarness`, `evaluateInPanel`,
 * `panelRectOf`, `clickInPanel`. The upper one knows THIS panel: it loads the
 * demo macros through the Dev settings drawer, expands a macro, opens a
 * step's pencil, opens the verb menu. Scenarios should read as prose about
 * the panel, so anything that names a selector belongs in this file.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ARTIFACT_DIR = "artifacts/ui/";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An OS-assigned free TCP port, released before the caller binds it. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Where Chrome is. `$CHROME` wins, then the macOS app bundle, then the names
 * a Linux CI runner has (`google-chrome-stable` on GitHub's ubuntu images).
 */
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    const found = spawnSync("command", ["-v", name], { shell: true, encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split("\n")[0];
  }
  throw new Error("No Chrome found. Set $CHROME, or install Google Chrome / Chromium on PATH.");
}

/**
 * Launch Chrome and attach to its first page target.
 *
 * `--headless=new` is the modern headless mode; the old one renders the panel
 * differently enough that container queries misreport. The temp profile keeps
 * the run out of the developer's own Chrome profile — and out of its
 * localStorage, which this panel uses for the demo macro store.
 */
export async function launchProbe({ baseUrl, artifactDir = DEFAULT_ARTIFACT_DIR } = {}) {
  const artifacts = join(REPO_ROOT, artifactDir);
  const port = await freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "ui-probe-chrome-"));
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      // GitHub's ubuntu runners cannot give Chrome its user-namespace
      // sandbox, and without this flag Chrome exits before it opens the
      // debugging port (CI run 34143912141, 2026-09-07). The profile is a
      // temp dir and the only page is our own dev server, so the sandbox
      // buys nothing here.
      "--no-sandbox",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  // Keep Chrome's last lines so a start-up failure says why.
  const tail = [];
  chrome.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim() === "") continue;
      tail.push(line);
      if (tail.length > 20) tail.shift();
      if (process.env.UI_PROBE_VERBOSE) console.log(`# chrome: ${line}`);
    }
  });

  let wsUrl = null;
  // 30 s: a cold runner unpacks Chrome's profile and fonts on first launch.
  for (let attempt = 0; attempt < 240 && wsUrl === null; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      wsUrl = list.find((target) => target.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {
      // Chrome is not listening yet.
    }
    if (wsUrl === null) await sleep(125);
  }
  if (wsUrl === null) {
    chrome.kill();
    throw new Error(
      `Chrome did not open a debugging port\n# chrome output:\n${tail.map((l) => `#   ${l}`).join("\n")}`,
    );
  }

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Could not attach to the Chrome page target"));
  });

  let nextId = 0;
  const pending = new Map();
  // Vite's dependency optimizer discovers a new dep on a first load and
  // forces a full page reload. It landed mid-scenario twice — an open drawer
  // vanished, a running recording went back to rest — and both read as app
  // bugs. Timestamp every document load so `settle()` can wait one out.
  let lastLoadAt = Date.now();

  // ---- the panel frame -------------------------------------------------
  //
  // The host harness seats the panel in `<iframe sandbox="allow-scripts">`.
  // Chrome isolates a sandboxed iframe into its own process
  // (IsolateSandboxedIframes), so the panel arrives as a SEPARATE CDP target
  // with its own session: `Runtime.evaluate` on the page session cannot see
  // its DOM at all. Auto-attach in flat mode delivers that session over the
  // one socket, and every command carrying `sessionId` is routed to it.
  //
  // A same-process frame attaches no target. Then the fallback is an
  // execution context: `Runtime.executionContextCreated` on the page session
  // reports one per frame, tagged with `auxData.frameId`, and evaluating
  // against that `contextId` reaches the frame's DOM.
  let panelSession = null;
  /** frameId → executionContextId, for the same-process fallback. */
  const contextByFrame = new Map();

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Page.loadEventFired" || message.method === "Page.frameStoppedLoading") {
      lastLoadAt = Date.now();
    }
    if (message.method === "Target.attachedToTarget") {
      const { targetInfo, sessionId } = message.params;
      if (targetInfo.type === "iframe") {
        panelSession = sessionId;
        // The child session starts with every domain disabled.
        for (const domain of ["Page", "Runtime", "DOM"]) {
          void send(`${domain}.enable`, {}, sessionId).catch(() => {});
        }
      }
      return;
    }
    if (message.method === "Target.detachedFromTarget") {
      if (message.params.sessionId === panelSession) panelSession = null;
      return;
    }
    if (message.method === "Runtime.executionContextCreated" && !message.sessionId) {
      const { id, auxData } = message.params.context;
      if (auxData?.frameId) contextByFrame.set(auxData.frameId, id);
      return;
    }
    if (message.method === "Runtime.executionContextsCleared" && !message.sessionId) {
      contextByFrame.clear();
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, (message) =>
        message.error
          ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
          : resolve(message.result),
      );
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  // Before the first navigation, or the panel frame's target attaches
  // unseen and nothing can reach it.
  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- generic helpers -------------------------------------------------

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`evaluate failed: ${detail}`);
    }
    return result.result.value;
  };

  /** Poll an expression until it returns something truthy, or give up. */
  const waitFor = async (expression, { timeout = 6000, interval = 100, what } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(expression);
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what ?? expression}`);
      }
      await sleep(interval);
    }
  };

  /** Wait until no document has finished loading for `quiet` milliseconds. */
  const settle = async ({ quiet = 1200, timeout = 20000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() - lastLoadAt < quiet) {
      if (Date.now() > deadline) return false;
      await sleep(100);
    }
    return true;
  };

  const setViewport = (width, height) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    });

  /**
   * Load the panel from scratch.
   *
   * Two things are deliberate. Chrome treats `Page.navigate` to the URL it is
   * already on as a no-op, so a scenario would inherit the last one's React
   * state — a review sheet left open once made three later scenarios fail;
   * the trip through `about:blank` forces the real reload. And the demo macro
   * store is `localStorage`, so it is wiped first: every scenario starts from
   * an empty rack, whatever ran before it.
   */
  const navigate = async (url = baseUrl, { keepStorage = false } = {}) => {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(50);
    if (!keepStorage) {
      await send("Storage.clearDataForOrigin", {
        origin: new URL(url).origin,
        storageTypes: "local_storage,indexeddb,cache_storage",
      }).catch(() => {});
    }
    await send("Page.navigate", { url });
    // React mounts into #root; the deck's Record key is the last thing the
    // resting panel paints, so it is the honest "ready" signal.
    await waitFor(`document.readyState === "complete" && !!document.querySelector('#root > *')`, {
      what: "the panel to mount",
      timeout: 20000,
    });
    await waitFor(`!!document.querySelector('[data-testid="record-button"]')`, {
      what: "the deck transport",
      timeout: 20000,
    });
    // Absorb a dev-server reload, then confirm the panel is up on the
    // document that survived it.
    await settle();
    await waitFor(`!!document.querySelector('[data-testid="record-button"]')`, {
      what: "the deck transport after the page settled",
      timeout: 20000,
    });
    // One frame for the entrance transitions to finish.
    await sleep(250);
  };

  /**
   * A DOMRect for a CSS selector, or for a JS expression that yields an
   * element (anything starting with `document`, `[...`, or `(`).
   */
  const asExpression = (target) =>
    /^(document|\[\.\.\.|\()/.test(target.trim())
      ? target
      : `document.querySelector(${JSON.stringify(target)})`;

  const rectOf = (target) => {
    const expression = asExpression(target);
    return evaluate(
      `(() => { const el = ${expression}; if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`,
    );
  };

  const mouse = async (type, x, y, { alt = false, button = "none", clickCount = 0 } = {}) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button,
      clickCount,
      modifiers: alt ? 1 : 0,
    });

  const hover = async (x, y, { alt = false } = {}) => {
    await mouse("mouseMoved", x, y, { alt });
    await sleep(120);
  };

  const click = async (x, y, { alt = false } = {}) => {
    await mouse("mouseMoved", x, y, { alt });
    await mouse("mousePressed", x, y, { alt, button: "left", clickCount: 1 });
    await mouse("mouseReleased", x, y, { alt, button: "left", clickCount: 1 });
    await sleep(180);
  };

  /**
   * Click the centre of whatever `target` resolves to, and return its rect.
   *
   * The panel scrolls in two places and the Dev drawer can push a rack row
   * under the strip below it, so the element is scrolled into view and the
   * point is hit-tested first. When the point still belongs to something
   * else, the click is dispatched through the DOM instead: driving the app
   * to a state is not the assertion — a scenario that wants to prove a real
   * pointer lands somewhere asks `onTopAt` itself.
   */
  const clickOn = async (target, options) => {
    const expression = asExpression(target);
    await waitFor(`!!(${expression})`, { what: `something to click: ${target}`, timeout: 4000 });
    await evaluate(
      `(() => { const el = ${expression}; if (el) el.scrollIntoView({ block: "center", inline: "nearest" }); })()`,
    );
    await sleep(120);
    const rect = await rectOf(expression);
    if (!rect) throw new Error(`nothing to click: ${target}`);
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    const reachable = await evaluate(
      `(() => { const el = ${expression}; const top = document.elementFromPoint(${x}, ${y});
        return !!(el && top && (el === top || el.contains(top))); })()`,
    );
    if (reachable) {
      await click(x, y, options);
      return rect;
    }
    await evaluate(`(() => { const el = ${expression}; if (el) el.click(); })()`);
    await sleep(180);
    return rect;
  };

  const key = async (name, { alt = false } = {}) => {
    const modifiers = alt ? 1 : 0;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, modifiers });
    await sleep(150);
  };

  /**
   * What paints on top at a point — `document.elementFromPoint`, described.
   * `within` (a selector) reports whether the hit is inside that element,
   * which is the whole question a stacking bug asks.
   */
  const onTopAt = (x, y, within = '[role="menu"]') =>
    evaluate(
      `(() => {
        const el = document.elementFromPoint(${x}, ${y});
        if (!el) return null;
        const host = document.querySelector(${JSON.stringify(within)});
        const name = (node) =>
          node.tagName.toLowerCase() +
          (typeof node.className === "string" && node.className
            ? "." + node.className.trim().split(/\\s+/).slice(0, 3).join(".")
            : "");
        return { tag: el.tagName.toLowerCase(), name: name(el), within: host ? host.contains(el) : false };
      })()`,
    );

  const screenshot = async (name) => {
    mkdirSync(artifacts, { recursive: true });
    const shot = await send("Page.captureScreenshot", { captureBeyondViewport: false });
    const file = join(artifacts, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    return file;
  };

  // ---- the host harness's panel frame -----------------------------------

  /** The `<iframe>` element in the harness page, in page coordinates. */
  const PANEL_FRAME = "#panel-slot iframe";

  /** Set only in the same-process fallback; the OOPIF path uses a session. */
  let panelContextId = null;

  /** The execution context of the child frame, when it has no own target. */
  const findPanelContext = async () => {
    const { frameTree } = await send("Page.getFrameTree");
    const child = (frameTree.childFrames ?? []).find((entry) =>
      String(entry.frame.url).startsWith(baseUrl),
    );
    if (!child) return null;
    return contextByFrame.get(child.frame.id) ?? null;
  };

  /**
   * Wait until the panel frame is reachable, and report HOW. `"target"` is
   * the out-of-process iframe Chrome gives a sandboxed frame; `"context"` is
   * the same-process fallback. Scenarios never care which — this exists so a
   * change in Chrome's process model shows up as a printed word rather than
   * as every panel assertion timing out.
   */
  const attachPanel = async ({ timeout = 20000 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (panelSession !== null) {
        panelContextId = null;
        return "target";
      }
      panelContextId = await findPanelContext();
      if (panelContextId !== null) return "context";
      if (Date.now() > deadline) throw new Error("the panel frame never became reachable");
      await sleep(100);
    }
  };

  /** `evaluate`, but inside the panel frame. */
  const evaluateInPanel = async (expression) => {
    if (panelSession === null && panelContextId === null) await attachPanel();
    const params = { expression, awaitPromise: true, returnByValue: true };
    if (panelSession === null) params.contextId = panelContextId;
    const result = await send("Runtime.evaluate", params, panelSession ?? undefined);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`evaluate in panel failed: ${detail}`);
    }
    return result.result.value;
  };

  /** `evaluate`, named for the harness page's own world (`window.harness`). */
  const evaluateInHost = (expression) => evaluate(expression);

  const waitForInPanel = async (expression, { timeout = 8000, interval = 100, what } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await evaluateInPanel(expression);
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what ?? expression} (in the panel)`);
      }
      await sleep(interval);
    }
  };

  /**
   * A panel element's box in PAGE coordinates: the frame's own box plus the
   * element's box inside it. `Input.dispatchMouseEvent` only ever goes to the
   * top page — Chrome routes the event down to the frame under the point —
   * so this is what makes `click(x, y)` land on something in the panel.
   */
  const panelRectOf = async (selector) => {
    const frame = await rectOf(PANEL_FRAME);
    if (!frame) return null;
    const inner = await evaluateInPanel(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
    );
    if (!inner) return null;
    return {
      x: frame.x + inner.x,
      y: frame.y + inner.y,
      w: inner.w,
      h: inner.h,
      frame,
    };
  };

  /**
   * Click the centre of a panel element with a real pointer, after scrolling
   * it into the frame's view. Falls back to a DOM `click()` when the point
   * belongs to something else — same rule as `clickOn`: driving the panel to
   * a state is not the assertion.
   */
  const clickInPanel = async (selector, options) => {
    await waitForInPanel(`!!document.querySelector(${JSON.stringify(selector)})`, {
      what: `something to click: ${selector}`,
      timeout: 8000,
    });
    await evaluateInPanel(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollIntoView({ block: "center", inline: "nearest" }); })()`,
    );
    await sleep(150);
    const rect = await panelRectOf(selector);
    if (!rect) throw new Error(`nothing to click in the panel: ${selector}`);
    const reachable = await evaluateInPanel(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false; const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!(top && (el === top || el.contains(top))); })()`,
    );
    if (reachable) {
      await click(rect.x + rect.w / 2, rect.y + rect.h / 2, options);
      return rect;
    }
    await evaluateInPanel(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); })()`,
    );
    await sleep(180);
    return rect;
  };

  /**
   * Load the host harness from scratch and wait for the panel inside it.
   *
   * The harness fetches the dev server's live `plugin.js`, evaluates it
   * against a fake `creator`, then mounts the real panel in a sandboxed
   * iframe. Everything the scenarios assert rides on that boot finishing, so
   * this waits for the fake host, the frame, the panel's transport key, and
   * finally for the handshake to have chosen the REAL sandbox over the mocks.
   */
  const navigateHarness = async (options = {}) => {
    const { requireRpc = true } = options;
    panelSession = null;
    panelContextId = null;
    contextByFrame.clear();
    await send("Page.navigate", { url: "about:blank" });
    await sleep(50);
    await send("Page.navigate", { url: new URL("host-harness.html", baseUrl).href });
    await waitFor(`document.readyState === "complete" && !!window.harness`, {
      what: "the fake host",
      timeout: 20000,
    });
    await waitFor(
      `(document.getElementById('log')?.textContent ?? '').includes('UI iframe mounted')`,
      { what: "plugin.js to be evaluated", timeout: 20000 },
    );
    const how = await attachPanel();
    await waitForInPanel(`!!document.querySelector('[data-testid="record-button"]')`, {
      what: "the panel's transport",
      timeout: 20000,
    });
    if (requireRpc) {
      // The panel falls back to mock gateways when the handshake times out
      // (four 150 ms tries). A suite that silently probed the mocks would
      // assert nothing about the sandbox at all.
      await waitForInPanel(`!document.querySelector('[data-testid="demo-mode-banner"]')`, {
        what: "the panel to talk to the real sandbox",
        timeout: 10000,
      });
    }
    // One frame for the entrance transitions to finish.
    await sleep(250);
    return how;
  };

  // ---- fake-scene helpers ----------------------------------------------

  /** Put the harness's fake selection on the named nodes ("A", "B", …). */
  const selectNodes = (names) =>
    evaluate(
      `(() => { window.harness.selection = ${JSON.stringify(names)}.map((n) => window.harness.nodes[n]);
        return window.harness.selection.map((n) => n.name); })()`,
    );

  /** One fake node's transform, read through the same proxies the plugin uses. */
  const readNode = (name) =>
    evaluate(
      `(() => { const node = window.harness.nodes[${JSON.stringify(name)}];
        if (!node) return null;
        const read = (prop) => (node[prop] ? node[prop].staticValue : undefined);
        return { name: node.name, position: read("position"), rotation: read("rotation"),
                 opacity: read("opacity"), scale: read("scale") }; })()`,
    );

  /**
   * Set the fake selection and wait for the deck caption to agree.
   *
   * The panel asks the sandbox what Record would watch about once a second
   * while it rests (`ui/state/AppContext.tsx`, PEEK_MS). A press that beats
   * that answer records the scope the caption still shows, so every scenario
   * that changes the selection has to wait here first. Returns the caption,
   * or null when it never said the expected name.
   */
  const selectNodesAndWait = async (names, expected, { timeout = 8000 } = {}) => {
    await selectNodes(names);
    return await waitForInPanel(
      `(() => { const v = document.querySelector('.deck-scope-value');
        return v && v.textContent.trim() === ${JSON.stringify(expected)} ? v.textContent.trim() : null; })()`,
      { what: `the caption to read ${JSON.stringify(expected)}`, timeout },
    ).catch(() =>
      evaluateInPanel(`document.querySelector('.deck-scope-value')?.textContent?.trim() ?? null`),
    );
  };

  /**
   * Press the deck's transport key and wait for the recording to be live.
   * `exact` holds Alt over the key, which is the promise the panel reads off
   * the pointer event itself (`ui/components/recordModifier.ts`).
   */
  const startRecording = async ({ exact = false } = {}) => {
    await clickInPanel('[data-testid="record-button"]', { alt: exact });
    await waitForInPanel(`!!document.querySelector('[data-testid="recording-view"]')`, {
      what: "the recording view",
      timeout: 10000,
    });
  };

  /** The same key again, then the review sheet the stop hands its steps to. */
  const stopRecording = async () => {
    await clickInPanel('[data-testid="record-button"]');
    await waitForInPanel(`!!document.querySelector('[data-testid="review-panel"]')`, {
      what: "the review sheet",
      timeout: 10000,
    });
  };

  /** Steps the deck's counter has seen this recording. */
  const recordedStepCount = async () => {
    const text = await evaluateInPanel(
      `document.querySelector('.lcd-count [aria-hidden="true"]')?.textContent ?? null`,
    );
    return text === null ? null : Number(text);
  };

  const waitForRecordedSteps = (count, timeout = 10000) =>
    waitForInPanel(
      `(() => { const el = document.querySelector('.lcd-count [aria-hidden="true"]');
        const n = el ? Number(el.textContent) : 0; return n >= ${count} ? n : null; })()`,
      { what: `${count} recorded step(s) on the deck counter`, timeout },
    );

  /** Save the reviewed recording and wait for its row on the rack. */
  const saveMacro = async () => {
    await clickInPanel('[data-testid="save-macro-button"]');
    return await waitForInPanel(`document.querySelectorAll('[data-testid="macro-row"]').length`, {
      what: "the saved macro's row",
      timeout: 8000,
    });
  };

  /** Play the first row and wait until nothing is running any more. */
  const playFirstMacro = async () => {
    await clickInPanel('[data-testid="play-button"]');
    await waitForInPanel(
      `!document.querySelector('[data-testid="playback-progress"]') &&
       !document.querySelector('[data-testid="playback-error"]')`,
      { what: "the run to finish", timeout: 15000 },
    );
  };

  // ---- panel helpers ---------------------------------------------------

  const macroRowCount = () =>
    evaluate(`document.querySelectorAll('[data-testid="macro-row"]').length`);

  const DEV_HEADER = `[...document.querySelectorAll('button[aria-expanded]')].find((el) => /dev settings/i.test(el.textContent ?? ""))`;

  const devSettingsOpen = () =>
    evaluate(
      `(() => { const b = ${DEV_HEADER}; return b ? b.getAttribute('aria-expanded') === 'true' : null; })()`,
    );

  /** Open the Dev settings drawer at the panel foot, if it is collapsed. */
  const openDevSettings = async () => {
    const open = await devSettingsOpen();
    if (open === null) throw new Error("no Dev settings header (is this a dev build?)");
    if (open) return;
    await clickOn(DEV_HEADER);
    await waitFor(`!!document.querySelector('[aria-label="Load demo macros"]')`, {
      what: "the Dev settings drawer",
    });
  };

  /** Collapse it again: open, the drawer takes half a short panel's height. */
  const closeDevSettings = async () => {
    if ((await devSettingsOpen()) !== true) return;
    await clickOn(DEV_HEADER);
    await waitFor(`!document.querySelector('[aria-label="Load demo macros"]')`, {
      what: "the Dev settings drawer to close",
    });
  };

  /** Put the rack back at the top so the first row sits beside the deck. */
  const scrollRackToTop = async () => {
    await evaluate(
      `document.querySelectorAll('main').forEach((el) => { el.scrollTop = 0; }); window.scrollTo(0, 0);`,
    );
    await sleep(150);
  };

  /** Seed the store from the drawer's Load demo key. A no-op when seeded. */
  const loadDemoMacros = async () => {
    if ((await macroRowCount()) > 0) return await macroRowCount();
    await openDevSettings();
    await clickOn(`[aria-label="Load demo macros"]`);
    await waitFor(`document.querySelectorAll('[data-testid="macro-row"]').length > 0`, {
      what: "the demo macros to appear",
    });
    await closeDevSettings();
    await scrollRackToTop();
    return await macroRowCount();
  };

  /** Expand the first macro row — the one nearest the deck. */
  const expandFirstMacro = async () => {
    const rowDisclosure = `document.querySelector('[data-testid="macro-row"] [data-row-disclosure]')`;
    await waitFor(`!!${rowDisclosure}`, { what: "a macro row" });
    if ((await evaluate(`${rowDisclosure}.getAttribute('aria-expanded')`)) !== "true") {
      await clickOn(rowDisclosure);
    }
    await waitFor(`${rowDisclosure}.getAttribute('aria-expanded') === 'true'`, {
      what: "the first macro row to expand",
    });
    return await waitFor(`document.querySelectorAll('li button[aria-label^="Edit step"]').length`, {
      what: "the expanded step list",
    });
  };

  /**
   * Open a step's inline editor (the pencil). The action lane only paints on
   * hover, so the hover is dispatched in-page and the click goes straight to
   * the button — React listens for `click`, not for a pixel.
   */
  const openPencil = async (match = /position|rotation|scale/) => {
    const opened = await evaluate(
      `(() => {
        const re = ${String(match)};
        const li = [...document.querySelectorAll('li')].find(
          (el) => re.test(el.textContent ?? "") && el.querySelector('button[aria-label^="Edit step"]'),
        );
        if (!li) return null;
        li.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        li.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const pencil = li.querySelector('button[aria-label^="Edit step"]');
        pencil.click();
        return { label: pencil.getAttribute("aria-label"), text: (li.textContent ?? "").slice(0, 60) };
      })()`,
    );
    if (!opened) throw new Error(`no step row matching ${String(match)}`);
    await waitFor(`!!document.querySelector('.key-verb')`, { what: "the step editor" });
    await evaluate(`document.querySelector('.key-verb').scrollIntoView({ block: "center" })`);
    await sleep(200);
    return opened;
  };

  /** Click the verb key of the first (or nth) editor row and wait for the menu. */
  const openVerbMenu = async (index = 0) => {
    await clickOn(`document.querySelectorAll('.key-verb')[${index}]`);
    await waitFor(`!!document.querySelector('[role="menu"]')`, { what: "the verb menu" });
    await sleep(150);
    return await rectOf(`[role="menu"]`);
  };

  const closeMenu = async () => {
    await key("Escape");
    await waitFor(`!document.querySelector('[role="menu"]')`, { what: "the verb menu to close" });
  };

  /** The verb and operand the first editor row now shows. */
  const readRow = (index = 0) =>
    evaluate(
      `(() => {
        const trigger = document.querySelectorAll('.key-verb')[${index}];
        if (!trigger) return null;
        const input = trigger.parentElement?.querySelector('input');
        return { verb: (trigger.textContent ?? "").trim(), field: input?.value ?? null };
      })()`,
    );

  const chipText = () =>
    evaluate(`document.querySelector('[data-testid="scope-chip"]')?.textContent ?? null`);

  const close = async () => {
    try {
      socket.close();
    } catch {
      // already gone
    }
    chrome.kill();
  };

  return {
    baseUrl,
    send,
    evaluate,
    waitFor,
    settle,
    navigate,
    setViewport,
    rectOf,
    click,
    clickOn,
    hover,
    key,
    onTopAt,
    screenshot,
    sleep,
    close,
    // the host harness's panel frame
    navigateHarness,
    attachPanel,
    evaluateInHost,
    evaluateInPanel,
    waitForInPanel,
    panelRectOf,
    clickInPanel,
    selectNodes,
    selectNodesAndWait,
    readNode,
    startRecording,
    stopRecording,
    recordedStepCount,
    waitForRecordedSteps,
    saveMacro,
    playFirstMacro,
    // panel-aware
    macroRowCount,
    openDevSettings,
    closeDevSettings,
    scrollRackToTop,
    loadDemoMacros,
    expandFirstMacro,
    openPencil,
    openVerbMenu,
    closeMenu,
    readRow,
    chipText,
  };
}
