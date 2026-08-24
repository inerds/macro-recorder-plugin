/**
 * Verifies the RPC dispatcher against REAL QuickJS semantics: the host
 * invokes the onMessage callback via vm.callFunction and does NOT pump the
 * job queue afterward (mirroring Creator's _wrapCallback). The hello
 * response must arrive without any executePendingJobs call.
 */
import { getQuickJS } from "quickjs-emscripten";
import { readFileSync } from "node:fs";

const pluginCode = readFileSync(
  new URL("../dist/plugin.js", import.meta.url),
  "utf8",
);

const QuickJS = await getQuickJS();
const vm = QuickJS.newContext();

const posted = [];
let onMessageCallback = null;

// --- hand-marshal a minimal `creator` global ---
const creatorHandle = vm.newObject();

// creator.ui
const uiHandle = vm.newObject();
vm.newFunction("show", () => vm.undefined).consume((f) => vm.setProp(uiHandle, "show", f));
vm.newFunction("postMessage", (msgHandle) => {
  posted.push(vm.dump(msgHandle));
  return vm.undefined;
}).consume((f) => vm.setProp(uiHandle, "postMessage", f));
vm.newFunction("onMessage", (cbHandle) => {
  onMessageCallback = cbHandle.dup();
  return vm.undefined;
}).consume((f) => vm.setProp(uiHandle, "onMessage", f));
vm.setProp(creatorHandle, "ui", uiHandle);
uiHandle.dispose();

// creator.selection with one fake node (enough for record.start/tick)
const selectionCode = `({
  get nodes() { return globalThis.__fakeSelection ?? globalThis.__fakeNodes; }
})`;
const sceneCode = `({
  id: "scene1", name: "Main Scene",
  get layers() { return globalThis.__fakeNodes; }
})`;
// fake node lives inside the VM so property reads are pure-VM
const fakeNodesSetup = `
globalThis.__fakeNodes = [{
  id: "n1", name: "Layer 1", type: "SHAPE_LAYER",
  position: {
    isAnimated: false,
    staticValue: { x: 10, y: 20 },
    keyframes: [],
    addKeyframes(list) {},
  },
  fills: [], strokes: [], masks: [],
  shapes: [{
    id: "s1", name: "rect", type: "RECTANGLE",
    size: {
      isAnimated: false,
      staticValue: { x: 80, y: 60 },
      keyframes: [],
      addKeyframes(list) {},
    },
    fills: [], strokes: [], masks: [], shapes: [],
  }],
}];
`;
vm.unwrapResult(vm.evalCode(fakeNodesSetup)).dispose();
const selHandle = vm.unwrapResult(vm.evalCode(selectionCode));
vm.setProp(creatorHandle, "selection", selHandle);
selHandle.dispose();
const sceneHandle = vm.unwrapResult(vm.evalCode(sceneCode));
vm.setProp(creatorHandle, "activeScene", sceneHandle);
sceneHandle.dispose();

vm.setProp(vm.global, "creator", creatorHandle);
creatorHandle.dispose();

// console
const consoleHandle = vm.newObject();
for (const level of ["log", "info", "warn", "error"]) {
  vm.newFunction(level, (...args) => {
    console.log("[vm]", ...args.map((a) => vm.dump(a)));
    return vm.undefined;
  }).consume((f) => vm.setProp(consoleHandle, level, f));
}
vm.setProp(vm.global, "console", consoleHandle);
consoleHandle.dispose();

// --- eval the real plugin bundle ---
const evalResult = vm.evalCode(pluginCode);
if (evalResult.error) {
  console.log("FATAL eval error:", vm.dump(evalResult.error));
  process.exit(1);
}
evalResult.value.dispose();
// initial eval pump (Creator does this too via evalCodeAsync)
vm.runtime.executePendingJobs();

if (!onMessageCallback) {
  console.log("FATAL: onMessage never registered");
  process.exit(1);
}

function sendToPlugin(message) {
  // EXACTLY like Creator's _wrapCallback: callFunction, NO job pump after.
  const argHandle = vm.unwrapResult(vm.evalCode(`(${JSON.stringify(message)})`));
  const result = vm.callFunction(onMessageCallback, vm.undefined, argHandle);
  argHandle.dispose();
  if (result.error) {
    console.log("callback error:", vm.dump(result.error));
    result.error.dispose();
  } else {
    result.value.dispose();
  }
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

// 1. hello must be answered synchronously — no pump allowed
posted.length = 0;
sendToPlugin({ t: "req", id: 1, method: "hello", params: {} });
check(
  "hello answered with NO job pump",
  posted.length === 1 && posted[0]?.ok === true && posted[0]?.result?.protocolVersion === 3,
  JSON.stringify(posted[0] ?? null),
);

// 2. record.start on the fake selection — sync response
posted.length = 0;
sendToPlugin({ t: "req", id: 2, method: "record.start", params: {} });
check(
  "record.start sync response (whole scene)",
  posted.length === 1 && posted[0]?.ok === true && posted[0]?.result?.nodeId === "scene1",
  JSON.stringify(posted[0] ?? null),
);

// 3. mutate the fake node inside the VM, then tick — diff must appear
vm.unwrapResult(
  vm.evalCode(`globalThis.__fakeNodes[0].position.staticValue = { x: 110, y: 20 };`),
).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 3, method: "record.tick", params: { seq: 1 } });
const tick = posted[0];
const step = tick?.result?.steps?.[0];
check(
  "record.tick returns diffed step synchronously with a layer binding",
  posted.length === 1 &&
    tick?.ok === true &&
    step?.label?.includes("position.x 10 → 110") &&
    step?.payload?.layer?.id === "n1",
  JSON.stringify(step ?? tick ?? null),
);

// 4. unknown method → sync error
posted.length = 0;
sendToPlugin({ t: "req", id: 4, method: "nope", params: {} });
check("unknown method errors synchronously", posted.length === 1 && posted[0]?.ok === false);

// 5. debug payloads are opt-in: a normal tick carries none
check(
  "tick carries no debug payload by default",
  tick?.result?.debug === undefined,
  JSON.stringify(tick?.result ?? null),
);

// 6. opting in attaches the snapshot pair that produced the steps
sendToPlugin({ t: "req", id: 5, method: "record.start", params: { debug: true } });
vm.unwrapResult(
  vm.evalCode(`globalThis.__fakeNodes[0].position.staticValue = { x: 210, y: 20 };`),
).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 6, method: "record.tick", params: { seq: 1 } });
const debugTick = posted[0]?.result?.debug;
check(
  "debug tick attaches prev/next SCENE snapshots synchronously",
  posted.length === 1 &&
    debugTick?.prev?.layers?.[0]?.props?.position?.static?.x === 110 &&
    debugTick?.next?.layers?.[0]?.props?.position?.static?.x === 210,
  JSON.stringify(debugTick ?? posted[0] ?? null)?.slice(0, 400),
);

// 7. deep recording: a child shape's size edit produces a deep-path step
sendToPlugin({ t: "req", id: 7, method: "record.start", params: {} });
vm.unwrapResult(
  vm.evalCode(`globalThis.__fakeNodes[0].shapes[0].size.staticValue = { x: 200, y: 60 };`),
).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 8, method: "record.tick", params: { seq: 1 } });
const deepStep = posted[0]?.result?.steps?.[0];
check(
  "child-shape size edit diffs synchronously with a deep path",
  posted.length === 1 &&
    JSON.stringify(deepStep?.payload?.path) === JSON.stringify(["shapes", 0, "size"]) &&
    deepStep?.payload?.shapeHint === "RECTANGLE",
  JSON.stringify(deepStep ?? posted[0] ?? null),
);

// 7b. capture offer: give the selected layer timeline keyframes, tick, and
//     the offer must ride the same synchronous response.
vm.unwrapResult(
  vm.evalCode(`
    globalThis.__fakeNodes[0].position.isAnimated = true;
    globalThis.__fakeNodes[0].position.keyframes = [
      { id: "kf1", frame: 0, value: { x: 10, y: 20 } },
      { id: "kf2", frame: 30, value: { x: 200, y: 60 } },
    ];
  `),
).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 20, method: "record.tick", params: { seq: 2 } });
const offer = posted[0]?.result?.captureOffer;
check(
  "record.tick carries captureOffer synchronously for a selected keyframed layer",
  posted.length === 1 &&
    offer?.layerId === "n1" &&
    offer?.keyframeCount === 2 &&
    offer?.pathCount === 1 &&
    offer?.selectedCount === undefined,
  JSON.stringify(offer ?? posted[0] ?? null),
);

// 7c. record.captureKeyframes answers synchronously with built steps whose
//     keyframe entries carry NO host ids (they are recycled by the host).
posted.length = 0;
sendToPlugin({
  t: "req", id: 21, method: "record.captureKeyframes",
  params: { layerId: "n1", scope: "all" },
});
const capStep = posted[0]?.result?.steps?.[0];
check(
  "record.captureKeyframes synthesizes keyframe steps with NO job pump",
  posted.length === 1 &&
    posted[0]?.ok === true &&
    capStep?.payload?.op === "keyframes" &&
    capStep?.payload?.added?.length === 2 &&
    capStep?.payload?.added?.[0]?.id === undefined &&
    capStep?.payload?.layer?.id === "n1",
  JSON.stringify(capStep ?? posted[0] ?? null),
);

// 7d. scope "selected" without a selected-keyframes surface errors cleanly
posted.length = 0;
sendToPlugin({
  t: "req", id: 22, method: "record.captureKeyframes",
  params: { layerId: "n1", scope: "selected" },
});
check(
  "capture scope=selected errors synchronously when the surface is absent",
  posted.length === 1 && posted[0]?.ok === false &&
    posted[0]?.error === "no-selected-keyframes",
  JSON.stringify(posted[0] ?? null),
);

// 7e. no selection → the tick carries no offer
vm.unwrapResult(vm.evalCode(`globalThis.__fakeSelection = [];`)).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 23, method: "record.tick", params: { seq: 3 } });
check(
  "tick with empty selection carries no captureOffer",
  posted.length === 1 && posted[0]?.result?.captureOffer === undefined,
  JSON.stringify(posted[0]?.result ?? null),
);
vm.unwrapResult(vm.evalCode(`delete globalThis.__fakeSelection;`)).dispose();

// 8. playback.begin answers synchronously; frameOffset appears ONLY when
//    atPlayhead is requested and the host exposes a timeline.
sendToPlugin({ t: "req", id: 9, method: "record.discard", params: {} });
const kfSteps = [
  {
    id: "k", kind: "keyframe", label: "kf",
    payload: { op: "keyframes", path: ["position"], added: [{ frame: 20, value: { x: 0, y: 0 } }], removed: [], changed: [] },
  },
];
posted.length = 0;
sendToPlugin({ t: "req", id: 10, method: "playback.begin", params: { steps: kfSteps } });
check(
  "playback.begin default response carries no frameOffset",
  posted.length === 1 && posted[0]?.ok === true && posted[0]?.result?.frameOffset === undefined,
  JSON.stringify(posted[0] ?? null),
);
sendToPlugin({ t: "req", id: 11, method: "playback.end", params: {} });
vm.unwrapResult(vm.evalCode(`globalThis.creator.timeline = { currentFrame: 50 };`)).dispose();
posted.length = 0;
sendToPlugin({ t: "req", id: 12, method: "playback.begin", params: { steps: kfSteps, atPlayhead: true } });
check(
  "playback.begin atPlayhead reads creator.timeline.currentFrame synchronously",
  posted.length === 1 && posted[0]?.result?.frameOffset === 30,
  JSON.stringify(posted[0] ?? null),
);
sendToPlugin({ t: "req", id: 13, method: "playback.end", params: {} });

onMessageCallback.dispose();
vm.dispose();
console.log(`\n${pass}/${pass + fail} QuickJS checks passed`);
process.exit(fail ? 1 : 0);
