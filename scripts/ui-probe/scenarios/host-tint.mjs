/**
 * The nameplate and the guide rollers take a tint from Creator's interface
 * colour (`--host-frame-bg`, what the theme relay paints on the gutter).
 * Only a browser can say whether an SVG `stop-color` written as
 * `color-mix(… var(--host-frame-bg) …)` actually resolves: set the variable
 * to a dark slate and to white, read the computed stop colour each time, and
 * keep a screenshot of each for the eye.
 */
const DARK = "rgb(61, 74, 94)"; // a Creator dark-theme slate
const LIGHT = "rgb(255, 255, 255)"; // Creator's light theme background

async function tintWith(probe, colour) {
  await probe.evaluate(
    `(() => {
      const frame = document.querySelector('.host-frame') ?? document.documentElement;
      frame.style.setProperty('--host-frame-bg', ${JSON.stringify(colour)});
    })()`,
  );
  await probe.settle?.(300);
  return probe.evaluate(
    `(() => {
      const stop = document.querySelector('#host-plate stop');
      const roller = document.querySelector('#host-hub stop');
      const plain = document.querySelector('#plate-metal stop');
      const rgb = (el) => el ? getComputedStyle(el).stopColor : null;
      // A mixed colour comes back as color(srgb r g b) in 0..1; a plain one as rgb(r, g, b).
      const parse = (s) => {
        const c = /color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/.exec(s ?? '');
        if (c) return c.slice(1, 4).map((v) => Math.round(Number(v) * 255));
        const m = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/.exec(s ?? '');
        return m ? m.slice(1, 4).map(Number) : null;
      };
      return { plate: rgb(stop), roller: rgb(roller), plain: rgb(plain), plateRgb: parse(rgb(stop)) };
    })()`,
  );
}

export default async function hostTint(probe) {
  const { check } = probe;
  await probe.setViewport(320, 560);
  await probe.navigate();

  const dark = await tintWith(probe, DARK);
  check(
    "the host-tinted gradients exist on the deck",
    !!dark.plate && !!dark.roller,
    JSON.stringify(dark),
  );
  check(
    "under a dark slate host the plate's top stop resolves to a real colour, not the raw expression",
    !!dark.plateRgb,
    String(dark.plate),
  );
  check(
    "the slate shows: the tinted plate is bluer than the untinted plate metal",
    !!dark.plateRgb && dark.plateRgb[2] > dark.plateRgb[0],
    `tinted ${dark.plate}, plain ${dark.plain}`,
  );
  await probe.screenshot("host-tint-dark");

  const light = await tintWith(probe, LIGHT);
  check(
    "under a white host the plate is brighter than under the slate host",
    !!light.plateRgb && !!dark.plateRgb && light.plateRgb[0] > dark.plateRgb[0] + 20,
    `light ${light.plate}, dark ${dark.plate}`,
  );
  check(
    "the two hosts give two different tints",
    light.plate !== dark.plate,
    `${light.plate} vs ${dark.plate}`,
  );
  await probe.screenshot("host-tint-light");
}
