/**
 * The deck's glass must show the whole drawing, edge to edge.
 *
 * `.deck-stage` has a hard pixel height in deck.css, tuned by hand against
 * the panel width the sandbox asks Creator for. Those two numbers drift
 * apart silently: the reels letterboxed inside the glass for a whole release
 * because the panel grew from 300px to 320px and the stage height did not.
 * So the probe reads the panel size out of `sandbox/plugin.ts`, sets exactly
 * that viewport, and compares the stage box against the SVG's own viewBox.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLUGIN_TS = fileURLToPath(new URL("../../../sandbox/plugin.ts", import.meta.url));

export default async function deckStageAspect(probe) {
  const { check } = probe;

  const source = readFileSync(PLUGIN_TS, "utf8");
  const shown = /creator\.ui\.show\(\s*\{([^}]*)\}/.exec(source);
  const width = Number(/width:\s*(\d+)/.exec(shown?.[1] ?? "")?.[1]);
  const height = Number(/height:\s*(\d+)/.exec(shown?.[1] ?? "")?.[1]);
  check(
    "the panel size is readable from sandbox/plugin.ts",
    Number.isFinite(width) && Number.isFinite(height),
    `creator.ui.show → ${width} × ${height}`,
  );
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;

  await probe.setViewport(width, height);
  await probe.navigate();

  const deck = await probe.evaluate(
    `(() => {
      const stage = document.querySelector('.deck-stage');
      const svg = stage?.querySelector('svg');
      if (!stage || !svg) return null;
      const box = stage.getBoundingClientRect();
      const viewBox = (svg.getAttribute('viewBox') ?? '').split(/\\s+/).map(Number);
      return {
        stage: { w: box.width, h: box.height },
        viewBox: { w: viewBox[2], h: viewBox[3] },
      };
    })()`,
  );
  check("the deck stage and its SVG are on the page", deck !== null);
  if (!deck) return;

  const wanted = deck.stage.w * (deck.viewBox.h / deck.viewBox.w);
  const off = Math.abs(deck.stage.h - wanted);
  check(
    `the stage box matches the ${deck.viewBox.w}×${deck.viewBox.h} viewBox within 1px`,
    off <= 1,
    `stage ${deck.stage.w.toFixed(1)}×${deck.stage.h.toFixed(1)}, wanted height ${wanted.toFixed(1)} (off by ${off.toFixed(2)}px)`,
  );

  await probe.screenshot("deck-stage-aspect");
}
