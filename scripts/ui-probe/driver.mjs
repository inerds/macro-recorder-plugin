/**
 * A very small headless-Chrome driver, over the DevTools protocol.
 *
 * There is no browser-automation dependency here on purpose: the suite needs
 * six page facts, not a framework, and CDP over Node 22's global `WebSocket`
 * costs nothing to install and nothing to keep current. Chrome is launched
 * once per run; every scenario re-navigates the one page.
 *
 * The helpers come in two layers. The lower one is generic — `navigate`,
 * `click`, `rectOf`, `onTopAt`. The upper one knows THIS panel: it loads the
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

const ARTIFACT_DIR = fileURLToPath(new URL("../../artifacts/ui/", import.meta.url));

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
export async function launchProbe({ baseUrl } = {}) {
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
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let wsUrl = null;
  for (let attempt = 0; attempt < 80 && wsUrl === null; attempt += 1) {
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
    throw new Error("Chrome did not open a debugging port");
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
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, (message) =>
        message.error
          ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
          : resolve(message.result),
      );
      socket.send(JSON.stringify({ id, method, params }));
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
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const shot = await send("Page.captureScreenshot", { captureBeyondViewport: false });
    const file = join(ARTIFACT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    return file;
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
