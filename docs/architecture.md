# Architecture

This document holds the invariants that give the code its shape: why the three
TypeScript projects are separate, what the QuickJS sandbox can and cannot do,
where the host proxies stop, and how the recording engine and the panel fit
together. Read it before you extend the engine. Read
[`runtime-api.md`](runtime-api.md) with it: the published typings still
diverge from the runtime in the places that file lists, and every workaround
anchors to a live-verified quirk listed there.

The panel and the sandbox are one loop. The panel polls the sandbox every
500ms over a small RPC protocol. The sandbox snapshots the active scene, diffs
it against the previous snapshot, and returns labeled steps. Replay sends the
steps back the other way. Everything between the proxy-touching files is
plain data.

- The design rules for the skin, the deck, and the rack are in
  [`design-system.md`](design-system.md).
- The trace-triage workflow is in [`contributing/triage.md`](contributing/triage.md).
- Confirmed host limits, with evidence, are in [`limitations.md`](limitations.md).

## Three TypeScript projects, deliberately separate

`tsconfig.json` is a solution file referencing three configs. The split is a
correctness boundary, not organization:

- `tsconfig.ui.json` — `["ui", "engine"]`, DOM libs, `vite/client` types.
- `tsconfig.sandbox.json` — `["sandbox", "engine"]`, **no DOM lib**, and
  `"types": ["creator-api-types"]` with `typeRoots` at `./node_modules/@types`
  and `./node_modules/@lottiefiles`, so the `creator` global resolves from
  `@lottiefiles/creator-api-types`. Also sets `noUncheckedIndexedAccess`,
  which the UI config does not.
- `tsconfig.node.json` — build tooling only (`vite.config.ts`,
  `scripts/trace-server.ts`), `"types": ["node"]`.

So `engine/` compiles under both and must not reference `window`, `document`, or
Node APIs. If an `engine/` module needs a platform capability, inject it (see
`parseImportedMacro(json, makeId)` in `engine/macro.ts`) rather than reaching for
a global.

## ENGINE_REV discipline

Bump `ENGINE_REV` in `engine/protocol.ts` with EVERY sandbox-behaviour change.
The handshake compares revisions, stamps both into traces
(`env.sandboxRev`/`uiRev`), and shows an in-panel banner on mismatch. Creator
evaluates `plugin.js` once and never re-fetches it, so a stale sandbox
reproduces bugs that are already fixed. When you triage any trace, check
`env.sandboxRev` FIRST.

The full rule, with the stale-sandbox trap and the dev-server recompile
behaviour, is in [`contributing/engine-rev.md`](contributing/engine-rev.md).

## The one hard runtime constraint

Creator invokes the sandbox's `onMessage` callback and does **not** pump the
QuickJS job queue afterward. A pure VM promise chain never resolves there. The
README states this; the consequences for how you write code:

- `sandbox/rpc-server.ts` calls the handler and, if the result is not a thenable,
  responds **inline in the same invocation**. Do not refactor that dispatch into
  `await handler(...)` — it would deadlock every sync method inside Creator while
  passing in a browser.
- An async handler is only safe if it *starts* by awaiting a native-backed
  promise. In practice that means `creator.clientStorage.*` (`sandbox/store.ts`);
  its settlement is what pumps the queue and drains the `.then()` continuations.
  A handler that awaits a VM-only promise first is dead code in Creator.
- A synchronous handler cannot await anything, so a value it must report is
  cached, not fetched. `hello` answers in its own invocation and returns
  `{protocolVersion, rev, usedQuota?}`; `sandbox/store.ts` holds the last
  reading of `creator.clientStorage.usedQuota` and refreshes it from every
  storage call, which is safe because each of those starts with a
  native-backed await. A host without the member reports no `usedQuota`.
- The sandbox has **no timers**. All timing lives in the UI —
  `RpcRecorderGateway` owns the 500ms tick loop and the sandbox only ever
  responds to messages.

`scripts/quickjs-smoke.mjs` enforces this by mirroring Creator's `_wrapCallback`
exactly: `vm.callFunction` with zero `executePendingJobs` after. If you add an
RPC method that must answer synchronously, add a check there.

## Host API surface (found via runtime introspection)

The real `Animatable` proxies expose `clearKeyframes()` (the bulk
animated→static call) and `getValueAt(frame)`. 0.0.2 omitted both, and 1.0.1
types them. Safe to feature-detect (`typeof prop.clearKeyframes === "function"`), never
assume. Conversely, per-fill opacity does NOT exist anywhere on the paint
surface (paint = `color`/`type`/`remove` only, colors are `{r,g,b}`) — do not
re-attempt to record it; it is a documented platform limit.

## Layering — where the proxies stop

**No `engine/` module touches a Creator node proxy.** Four `sandbox/` files
do, and each one owns a different part of the boundary:

- `sandbox/serialize.ts` — proxy → `NodeSnapshot`. Every snapshot in the
  system comes from here, and nothing else reads a node for recording.
- `sandbox/applier.ts` — `StepPayload` → proxy writes on ONE target node,
  plus `delayLayer`'s timing write.
- `sandbox/playback.ts` — the scene level: it resolves a recorded layer id to
  a live node, runs the structural ops (create, remove, reorder, break, nest),
  writes one scene setting per `set-scene` step, and reads each target back
  for the trace probes. It shares `serialize.ts`'s `valueToJson` for those
  reads, because a probe must see the same value the recorder would.
- `sandbox/recorder.ts` — the session: it holds the pinned scene, reads
  `creator.selection` for the nudge count and the capture offer, and runs the
  dev-only introspection probes. Outside those probes it reads no node value
  of its own — the tick's data comes from `serializeScene`.

Everything downstream of the four is plain data and unit-testable without a
Creator mock. Preserve that: new engine logic belongs in `engine/`, driven by
snapshots, and a new node reader belongs in one of these four files. The rest
of the host API is not the scene graph and stays out of them:
`sandbox/store.ts` owns `creator.clientStorage`, `sandbox/theme.ts` owns
`creator.ui.theme`, and `sandbox/plugin.ts` with `sandbox/rpc-server.ts` own
the message channel.

`engine/testing/fakeScene.ts` is the test double for that proxy surface, shared
by `dev/harness/host-harness.html` and vitest. It models the
`creator-api-types` 1.0.1 surface, corrected by
[`runtime-api.md`](runtime-api.md) and [`limitations.md`](limitations.md),
which win where the two disagree. It reproduces the real API's traps on
purpose — most importantly that the host silently discards an assignment to
`staticValue` when keyframes exist (runtime quirk 4). It also REFUSES what the
host refuses: paint lists on a geometry node, masks on a shape, layer flags on
a group, `mode` on a trim path, `opacity` on a paint, a bare array to
`createGroup`, and any unknown key in a `create*` options object (with the
live host's `✗ Invalid input`). Its header comment holds the full list. Never
make the fake more permissive than the real host; that would hide the bugs it
exists to catch — the 2026-09-06 pass that tightened it exposed five real
applier bugs at once. A `SCENE_LAYER` node carries a real inner scene
(`makeInnerScene`: `layers`, `isNestableScene`, the three layer factories, and
`remove()`), which stays inside that rule: 1.0.1 types the inner scene and its
factories, the live shell carries `scene.layers`, and the engine
feature-detects each factory. The root scene's own `createSceneLayer()` stays
empty and selection-blind, as runtime quirk 8 describes.

Every proxy reader is defensive, because proxies vary by node type and any
getter can throw — `serialize.ts` wraps every read in `tryRead` and simply
omits unreadable properties; `engine/json.ts#toJson` deep-copies into JSON-safe
data with a depth cap so nothing uncloneable escapes into an RPC payload. An
absent property is a normal outcome, never an error.

## Engine v3 — whole-scene diff, selection-scoped recording (2026-08-22, scoped 2026-09-07)

`runtime-api.md` is required reading: the published typings still diverge from
the runtime in the places it lists, and every workaround in the engine anchors
to a live-verified quirk listed there. Introspect before extending (record.start's debug probe
dumps node/scene surfaces into traces).

```
UI tick (500ms)                     sandbox
RpcRecorderGateway ──record.tick──▶ serializeScene(activeScene) → SceneSnapshot
                                    diffScene(prev, next) → StepPayload[]
                                    partitionByScope(payloads, scope) → kept + ignored
                   ◀─── steps ───── buildStep() → {kind, label, payload}
```

- Recording snapshots and diffs the WHOLE active scene every tick, whatever
  the scope (see the scope bullet below): every layer's subtree (shapes recurse; scene-instance layers expose their source
  scene's layers as the child channel), fills/strokes/masks/trims, plain
  flags (incl. text props), names. `diffScene` matches layers by id and emits
  scene ops: `add-layer` (with structural duplicate detection → `cloneOf`,
  transform-agnostic, plus recorded position `offset`), `remove-layer`,
  `reorder-layers` (since rev .52 the payload also carries `layers:
  LayerRef[]` — replay verifies those identities and refuses to permute a
  scene that isn't the recorded one; legacy identity-less payloads reorder
  positionally WITH a caution note), `break-scene` (removed SCENE layer +
  adds in one tick),
  `nest-layers` (added SCENE layer + removals in one tick). In-layer payloads
  carry a `layer: LayerRef {id, name, priorName}` binding and, on deep paths,
  a `shapeHint`. A mask's `mode` rides the `set-plain` channel (1.0.1 `Mask`
  types it as a plain string), and a linear↔radial gradient swap records as
  `replace-paint`, because no host gradient carries a writable `type`.
- **The recording is pinned to ONE scene.** `record.start` captures
  `creator.activeScene`, and every tick re-serializes that same proxy. A user
  who switches scenes mid-recording gets ONE `not-replayable` step that says
  so: `record.tick`'s result has no notes channel, and a step is visible in
  the review list and deletable there.
- **Scene settings (rev 2026-09-06.3)**: `SceneSnapshot` is
  `{sceneId?, settings?, layers}`. `settings` holds `name`, `size`,
  `backgroundColor` (`null` = transparent), `framerate`, and `duration` — the
  plain mutable members of 1.0.1 `Scene`. Each changed key becomes one
  absolute `set-scene` step, applied ONCE per run against `creator.activeScene`
  in `sandbox/playback.ts#applySceneSetting`, never per target. Both fields
  are optional: a snapshot recorded before this rev carries no `settings`, and
  `diffSceneSettings` emits nothing when either side lacks the key.
- **A solo-layer macro needs a selection (rev 2026-09-08.2).** A macro that
  touched at most one pre-existing layer replays in TARGETS mode, and targets
  mode plays onto the selection only: with an empty selection `playbackBegin`
  throws `no-selection`. The panel does not treat that as a step failure. The
  gateway emits the `needs-selection` step result, `AppContext` rests the
  panel the way a stopped run does, and a toast asks: *Select a layer to play
  this macro on.* No dialog, no row left playing. User decision (2026-09-08):
  playing onto the recorded layer writes to a target the user cannot see,
  which is what the recording scope removes on the recording side. Two
  earlier answers were both wrong for the same reason — a scene rebuild
  writes the recorded END values verbatim, so right after recording the layer
  already sits there and the run "succeeds" with identical before/after
  probes and no note (traces 2026-09-08T02-19-34, 02-19-41), and a targets
  replay onto the recorded layer moves a layer nobody selected. A
  settings-only macro still takes scene mode, because it binds to no layer.
  Scene mode keeps the rebuild for multi-layer and structural macros, and its
  verbatim `set-static` write reports `already at this value — nothing
  changed` (an `info` note) when the layer already holds the value, then
  writes anyway.
- **Recording scope (rev 2026-09-07.2)**: `record.start` decides ONCE what
  the recording watches, from `creator.selection.nodes`. Layers selected →
  `{kind: "layers", ids}`; a selected shape resolves to its owning top-level
  layer (`engine/scope.ts#resolveScope` walks each layer's `shapes`, the
  scene-layer child channel included; masks and paints have no ids and are
  never selected). Nothing selected → `{kind: "scene"}`, the whole scene as
  before. A non-empty selection that matches no layer of the active scene
  falls back to the scene with `fallback: "unresolved"`, and the panel says
  so. User decision (2026-09-07): recording noise on unselected layers was
  the reported bug, and selection-before-Record is the rule the user wanted,
  with whole-scene recording kept for structure macros.
  The scope PARTITIONS the diff; it never filters the snapshots. `diffScene`
  still runs on the whole scene, because clone detection needs every `prev`
  layer for `cloneOf`, the reorder rule needs the full survivor order, and
  nest/break detection correlates the full removed and added sets in one
  tick. `partitionByScope` then keeps a payload when its `layer` ref is in
  scope, keeps every `add-layer` and grows the scope with its id (a layer
  that did not exist at record.start cannot be a stray edit; a clone of an
  unscoped layer keeps its `cloneOf`), keeps `nest-layers` and `break-scene`
  when they touch a scoped layer and grows the scope with what they create,
  keeps `reorder-layers` only when a scoped layer's position among the
  survivors changed, and drops `set-scene` (scene settings belong to
  whole-scene recordings). Growth is collected in a first pass, so payload
  order within a tick does not matter. Dropped payloads are COUNTED:
  `record.tick` returns a cumulative `ignored`, the recording chip shows
  "2 changes outside Layer A ignored", and `RecordDebug.ignored` marks the
  tick in traces. Nothing is dropped in silence. When the scope grows, that
  tick's result carries the grown `scope`, so the chip and the review hint
  name what is watched now. A single-layer scope also saves that layer, not
  the scene, as the macro's `source`; replay does not depend on it (a
  layer-bound macro that touched SEVERAL layers with nothing selected takes
  scene mode and resolves by recorded id and name, and one that touched a
  single layer asks for a selection). The capture offer is withheld for a selected layer
  outside the scope, and `record.captureKeyframes` refuses one.
- **Scope readout before Record**: the sandbox has no timers, so the panel
  polls `selection.peek` at 1 Hz while idle (`AppContext`, paused when the
  document is hidden). The handler reads a light `serializeSceneIndex` (ids,
  types, names, shapes — no animatables) and resolves the scope the same way
  `record.start` will. `bridge.ts` keeps `selection.peek` out of trace
  bundles, like `hello`, or every bundle would collect a pair per second;
  the poll itself traces its FIRST failure and backs off to 16 s while the
  failures continue, so a stale sandbox without the method is visible once
  and not hammered.
  The deck's `.deck-scope` line shows the name alone — `LAYER A` /
  the scene's name (`MAIN SCENE`; `WHOLE SCENE` only when the host gives
  none) — while idle and while recording (design-system.md). The
  older selection nudge (rev .48) is gone; the scope chip took its place
  under the discard confirm, and the capture offer stacks ABOVE the chip
  rather than replacing it — the chip's counter is the only report of a
  dropped edit, and a keyframed layer can stay selected all session.
- Toasts are restyled in index.css as compact ink chips (the library's
  hardcoded dark slab is full-app-scale; attribute-contains selectors on
  the fixed z-100 viewport, same strategy as the dialog-slide fix).
- **Keyframe capture (rev .42)**: while recording, `record.tick`'s result
  carries a `CaptureOffer` when exactly one non-`SCENE*` top-level layer
  with keyframes is selected — computed from the tick's OWN snapshot plus a
  defensive `selection.nodes` read, never a second serialize.
  `record.captureKeyframes` (sync handler) synthesizes steps via
  `engine/capture.ts` from **`lastSnapshot`** — never a fresh serialize.
  Scope "all" is a FULL-STATE capture (rev .43, fills whole since .45):
  each fill first as `replace-paint` with its complete PaintSnapshot —
  kind and gradientType survive replay, animated-only components seeded
  from their earliest keyframe (TEXT_LAYER singular fills stay
  component-captured; no replace surface) — then keyframes ops, then
  static animatables as `set-static` and content plain flags as `set-plain`
  with before === after — deep paths replay exactly, length-1 transform
  statics are additive-zero (style capture never teleports the target;
  pinned in applier.test), and `labelOf` renders equal pairs as
  `prop = value`. "Add selected keyframes" stays keyframes-only. Rationale: that keeps capture and the diff stream disjoint by construction
  (a post-tick edit arrives as a diff step; nothing double-emits; ≤500ms
  staleness accepted). The walk mirrors `diffNodeInner`'s addressing exactly
  and strips host keyframe ids (recycled). `selection.keyframes` is
  SETTLED: live but permanently EMPTY on the real host (five sessions of
  probe evidence — `limitations.md`, taxonomy #17); `selectedCount` is
  present only when the getter reads as an array OR the feature-detected
  `selection:keyframes` event listener (rev .46, `initSelectionEvents`)
  has an event bus — the event cache feeds the offer/capture when the
  getter polls empty, and `selectionIntrospection.events.{supported,fired,
  lastCount}` in the next debug trace proves whether the host ever fires
  it. `RpcRecorderGateway` dedupes offer emissions — without
  that the recording screen re-renders at 2Hz. UI: `CaptureOfferRow` shares
  the above-feed slot with the discard confirm, which wins; notices now
  ride in recording mode too (the toast bridge reads idle OR recording).
- **Replay picks a mode in `chooseMode` (sandbox/playback.ts)**: macros
  touching >1 pre-existing layer or containing unretargetable scene ops
  (remove/reorder/break/nest/fresh add-layer) replay as SCENE SCRIPTS — each
  step resolves its layer id → name → priorName → skip-note; values apply
  exactly; layers created during the replay register in `layerByRecordedId`
  so later steps bound to recorded new-layer ids find them. `playbackBegin`
  filters the selection to LAYERS before it picks a mode
  (`creator.utils.isLayer`, feature-detected, with a `startFrame` fallback)
  and notes the shapes it dropped: steps address layer paths, so a selected
  shape is never a target. Macros touching
  ≤1 pre-existing layer with a selection replay in TARGETS mode — apply to every
  selected layer with smart offsets (`propClassOf`: only length-1 transform
  paths are relative; origins = recorded first-touch value, keyframed paths
  use the lowest-frame value); duplicate steps clone each SELECTED layer
  (chained duplicates clone the replay's copies via per-target maps) and
  shift by the recorded offset from the target's own position.
- **Replay means DO IT**: nest/add ops re-execute; adoption of an existing
  layer (id-only match) is the fallback for same-scene replays where the
  action already happened (prevents duplicate/empty-shell rebuilds). The
  `nest-layers` chain runs in this order (rev `2026-09-07.1`): filter the
  step-time selection through `isLayerNode`, take the sources (that
  selection, else the recorded layers), set `creator.selection.nodes` to
  them, and call `scene.createSceneLayer()` ONCE. A shell that comes back
  holding the layers ends the chain — the host moved them. Otherwise
  `nestByRebuild` rebuilds each source inside the shell's own scene from its
  `serializeNode` snapshot, verifies the copies by reads, moves the shell to
  the first source's slot, and removes the rebuilt originals. A verification
  miss removes the shell and leaves the originals untouched. Only an empty
  selection adopts the recorded nest when it is still live, or rebuilds it
  from the recording when there is nothing to adopt. The older rungs are gone
  — `createSceneInstance` never existed, `createSceneLayer(layers)` returns
  undefined, and `shiftTo` takes a frame (`limitations.md`).
  `createLayerFromSpec` picks the factory by recorded type — `SCENE*` →
  `createSceneLayer`, `TEXT_LAYER` → `createTextLayer` (feature-detected;
  absent → note + skip, never a shape shell), else `createShapeLayer`. A
  text layer rebuilt as a shape shell was the worst silent failure found in
  traces: every later text/font write landed on nothing and re-recording the
  shell captured nothing (taxonomy #12).
  `nest-layers` prefers the current selection as its sources (tool
  semantics); inside instance content, resolution is strictly index-ordered
  (user decision — no shape-type redirect there).
- **Nothing applies silently**: `applyStep` returns `StepOutcome.notes` and
  the parallel `noteKinds` for
  deliberate non-applies/adaptations (cross-kind recolors: gradient stops
  onto a solid LIST fill CONVERT the fill to a gradient via the
  replace-paint mechanism so the full stop values survive — user decision,
  2026-08-25, rev .44; solid color onto a gradient still tints every stop;
  singular text fills and strokes keep first-color adaptation since they
  have no removal semantics; static and keyframed both; trim edits create
  the trim on demand; paint paths remap singular text fills). Genuine failures throw and pause. Keep
  this invariant — silent half-applies were the original disease. It extends
  to `set-plain`: the applier reads the flag back after writing and notes a
  mismatch ("Creator kept the X as it was — the change didn't apply"); an
  unreadable read-back makes no
  claim (taxonomy #13). Hosts can accept an assignment and keep their own
  value, so a bare write is never proof of application.
- **A note carries its kind** (rev `2026-09-06.4`): `NoteList.push` records a
  `skip` — the step did not fully apply — and `NoteList.info` records an
  `info`, an adaptation that worked. The kind rides the `playback.step`
  result, and `summarizePlaybackNotes` (`ui/state/playbackNotes.ts`) counts
  the skips alone, so a run that only adapted reads "3 steps adjusted". A
  note from an older sandbox carries no kind, and the panel reads it as a
  skip. `push` stays the default, so a new note is conservative until its
  author says otherwise.
- Keyframe machinery (applier): frame-keyed matching via `getKeyframeAt` with
  `hasKeyframes` phantom-guard, verified adds + frame-0 sentinel, same-frame
  add+remove guard (legacy macros), move re-pairing in the differ, collision
  upsert (occupant gives way), per-entry fault tolerance.

## v3.1 pro-workflow layer (simplify / edit / play options / params)

Where each piece lives and the invariants worth keeping:

- `engine/simplify.ts` is pure and order-preserving. A run is keyed by
  (layer id, pathKey); structural/scene ops and disabled steps are barriers,
  and a static edit never merges with a keyframe edit on the same path (the
  value's meaning changed). `foldKeyframes` is the net-delta algebra —
  extend it with a test per new case, it's easy to get a sign wrong.
- The review sheet opens on the SIMPLIFIED list: `RECORD_STOP` carries an
  `autoSimplify` flag (absent means true) and the reviewing state keeps
  `rawSteps` beside `steps` so `REVIEW_SIMPLIFIED_TOGGLE` can swap between
  them. The user's choice lives in an `autoSimplifyRef` in `AppContext` —
  a session memory, not storage: the plugin iframe has no reliable
  `localStorage`, and `clientStorage` is a sandbox round trip that a
  preference does not earn.
- `engine/editing.ts` is the single definition of "editable": the review
  row, the macro detail, and the parameter form must all go through
  `editableValueOf`/`withEditedValue` so a value kind that's editable in one
  place is editable everywhere (and relabeled the same way).
- **A step's arithmetic is one linear form, not a set of operators.** Every
  expression a user can type into a step's box is linear in the current
  value, so it reduces to one pair — `target = scale × current + offset`,
  `LinearTerm` in `engine/steps.ts`. `apply?: StepFormula` holds one term for
  a scalar property and one per numeric component for a vector. The first cut
  of this feature stored a three-value `StepOperator` enum and put three keys
  in the row; exact, add, and multiply are three points in the term space, so
  the enum bought a control the user had to read and gave nothing the pair
  does not. The row shows one verb menu and one number box per component —
  Set to, Add, Subtract, Multiply, Divide, and Formula… for the raw
  expression — and `ui/components/formulaControl.ts` DERIVES the verb from
  the stored term, so the pair stays the only thing on disk.
- **`explicitFormulaOf` (`engine/operator.ts`) is the only reader of
  `payload.apply`.** It honours a term or a per-component record, converts
  the first cut's `"exact"` / `"add"` / `"multiply"` strings to the formula
  they meant on a `set-static` step, drops them on a `keyframes` step, and
  treats anything else as absent. One reader is what keeps a macro saved by
  an older build from reaching a `toFixed` on `undefined`; `PanelErrorBoundary`
  (`ui/main.tsx`) is the second line, so a render error shows what happened
  instead of a blank panel.
- **`engine/formula.ts` is the parser, and it is the only place text becomes
  a term.** A tokenizer plus recursive descent over the usual precedence,
  evaluating to a polynomial in `v` of degree 1. `+` and `-` add polynomials,
  `*` needs a constant on one side, `/` needs a non-zero constant divisor,
  and `(`, `)` group. Anything of a higher degree is refused, so `v * v` and
  `10 / v` never reach a payload. `formatFormula` is the inverse the box
  opens with, and `FORMULA_ERRORS` is the whole vocabulary of refusals — one
  short line each, which the editor prints under the fields.
- **`engine/operator.ts` still answers for a step with no formula.**
  `payloadClass(payload)` is the single choke point the applier and the
  origin tracker ask: the path's class — position, rotation, skew, skewAxis
  shift, scale multiplies — unless the recorded end value is an identity,
  which reads as a RESET and applies exactly. The heuristic is derived from
  the payload, not stored, so it corrects macros recorded before formulas
  existed; nothing migrates. `termsOf` (`engine/formula.ts`) turns that
  answer into the term the box shows.
- **An explicit formula reads the LIVE current value; a step without one
  keeps the frozen-baseline math.** `apply` is applied per component at write
  time against a fresh read of the target (`readBaseline`), so chained
  formula steps compose on what the previous step actually wrote. A step with
  no `apply` still runs `computeTarget` against the baselines frozen at
  `playback.begin` and the first-touch origins, and `rebaseAfterWrite`
  (`sandbox/playback.ts`) re-anchors a path after an exact set-static lands
  so a later relative step aims at the value that was written. That re-anchor
  is per target — `playback.originsByTarget` laid over the shared
  `playback.origins` — because the write is: a target whose property is
  keyframed takes nothing while its neighbours write, and a shared origin
  would aim its later steps at a value it never reached. Explicit formulas
  need no rebase, because they never read a frozen number.
- **Scene mode ignores formulas and writes `after`.** A rebuild reproduces
  the recording, and there is no per-target current value to be relative to —
  `context.mode === "scene"` says so outright, rather than being inferred
  from an empty baseline map. So `after` has to stay truthful:
  `withEditedValue` recomputes it as `evalTerm(term, before)` per component on
  every formula edit, and the label is rebuilt from the same pair.
- `EditableValue` gains one case, `{ kind: "formula"; fields }` — one text
  per component, `{ value }` for a scalar and `{ x, y }` for a vector — and
  `withEditedValue(step, next)` keeps its two parameters. The UI holds text,
  the payload holds terms, and `engine/formula.ts` is the only crossing.
- Disabled steps never reach the sandbox: `enabledSteps` in
  `ui/gateways/types.ts` filters client-side, so playback indices are into
  the ENABLED list. Repeat ×N is also purely client-side (one
  begin/steps/end pass per iteration; progress = iteration×len + index).
- The only sandbox part is the frame shift: `playbackBegin` computes
  `frameOffsetBase = currentFrame − earliestKeyframe(steps)` (0 when the
  host has no readable timeline or the macro has no keyframes) and
  `applyKeyframes` shifts the payload ONCE up front so matching and
  placement both see shifted frames. Stagger is `+ i × staggerFrames` per
  target in targets mode only.
- **A macro with no keyframes has nothing to shift, so stagger delays the
  layer** (rev `2026-09-04.1`): `begin` decides, step 0 acts. `playbackBegin`
  parks `delay: { base?, perTarget }` on the session when
  `hasKeyframes(steps)` is false, the mode is targets, and this is Repeat
  pass 0 (`iteration`, sent by `playbackGateway`); `playbackStep` at index 0
  calls `delayLayer` once per target before the step applies. `delayLayer`
  (`sandbox/applier.ts`) is the only proxy toucher: it moves `startFrame` and
  `timelineOffset` by the same delta, never writes `endFrame`, and turns
  every outcome — including a host that keeps its own value — into a note.
  Two reasons for the split: the per-target notes channel already reaches the
  toast and the `playback-event` trace record, and `playback.begin`'s result
  stays byte-identical. Keyframed macros never enter this path, so their
  cascade is unchanged. Stagger that CANNOT act (scene mode, or one target)
  parks a `staggerNote` reported the same way — nothing applies silently.
- Params reference step ids; anything that regenerates ids (import,
  duplicate) or removes steps (delete, simplify) must remap or drop pins.

## The gateway seam

`ui/gateways/index.ts` is the only place that decides real-vs-mock. It pings
`hello` (4 × 150ms) and falls back to mocks + `DebugStrip` on timeout. The UI
depends only on the three interfaces in `ui/gateways/types.ts` — components
never import an RPC class directly, which is what makes every UI state reachable
standalone.

Two subtleties worth knowing before changing it:

- Falling back to mocks *inside an iframe* means the handshake failed inside
  Creator, which is a bug, not a dev convenience. `app.tsx` renders a loud
  "Demo engine" banner for that case (`data-testid="demo-mode-banner"`) rather
  than silently showing fake data.
- A REJECTED handshake must reach the same place. `ui/main.tsx` used to have
  no rejection handler, so a throw inside `createGateways` left the panel
  blank for the whole session. It now catches, builds the mock gateways
  itself, and renders the demo-engine panel. A second failure writes one
  plain line into `#root`: "Macro Recorder could not start. Remove and re-add
  the plugin in Creator."
- After falling back, the client keeps asking. A UI inside a frame re-sends
  `hello` (1s while the sandbox is probably still booting, 5s after 20s) and
  reloads the page the moment it answers, so a lost boot race costs seconds
  instead of the session. A standalone tab never retries — it has no host
  above it, and its mocks are the point. The `sandbox-ready` notify triggers
  the same reload, but it cannot replace the retry: the sandbox posts it at
  plugin-eval time, when the iframe does not exist yet.

`RecorderGateway.stop()` returns the **final delta only** — steps captured since
the last `onStep` emission. It is not a full replay of the session; the UI has
already accumulated the earlier ones.

## UI state

`ui/state/appReducer.ts` is a single discriminated union over
`idle | recording | reviewing | playing`. Every case guards on `state.mode` and
returns `state` unchanged when the event doesn't apply to the current mode — keep
that pattern; it is what makes late-arriving gateway callbacks (a tick that lands
after stop) harmless. The reducer is pure and fully unit-tested; side effects
live in `ui/state/AppContext.tsx`.

**The exact-values modifier is stamped in the reducer, not in the sandbox.**
Option or Alt on either Record key sets `exact` on the recording state, and
`STEP_RECEIVED` then passes each step through `engine/exact.ts#withExactApply`,
which writes `apply = { scale: 0, offset: after }` onto an eligible
`set-static` and rebuilds its label. The modifier changes how the panel STORES
what the host reported, never what the host is asked for, so the recorder
gateway, `sandbox/recorder.ts`, and `ENGINE_REV` are all untouched — and the
stamp stays a pure function the reducer tests cover.

## Runtime environments this code must survive

Three, and they differ in what globals exist:

| | `crypto.randomUUID` | `localStorage` | timers | DOM |
|---|---|---|---|---|
| browser tab (standalone dev) | yes | yes | yes | yes |
| Creator UI iframe (opaque origin) | **no** | **throws** | yes | yes |
| QuickJS plugin sandbox | **no** | n/a | **no** | **no** |

`engine/id.ts#newId` exists for exactly this and is the only id source — never
call `crypto.randomUUID` directly. The same table is why the panel must never
rely on **native form submission**: Creator's sandboxed iframe can lack
`allow-forms`, which silently swallows the submit event (the Set values
sheet's Play was dead in Creator while passing every standalone check).
Buttons act via `onClick`, Enter via key handlers; an `onSubmit` may exist
only to `preventDefault()`. Persistence is likewise environment-split:
`LocalMacroStore` (localStorage, with in-memory fallback when it throws) versus
`RpcMacroStore` → `sandbox/store.ts` (`creator.clientStorage`, keys prefixed
`macro:`, one entry per macro).

## The build — two bundlers, one dist

`vite.config.ts` runs Vite 8 with `@lottiefiles/vite-plugin-creator` from the
npm registry (no vendored tarballs since 2026-09-06; the registry plugin is
what requires Vite 8). Vite's own bundler builds ONLY `ui.html`: the plugin
reads `sandbox/manifest.json`, derives the entry from its `entry` field, and
makes `plugin.js` with its own esbuild call. `pnpm build` therefore emits
exactly three files — `manifest.json`, `plugin.js`, `ui.html` — and a
sandbox-side change is proven only by `pnpm test:quickjs`, which drives the
compiled bundle.

`vite build --mode development` is the dev build. `injectManifestVersion`
stamps `<version>-dev`, appends `(dev)` to the name, and swaps in a SECOND
fixed plugin id. Creator scopes `clientStorage` by the manifest id, so
without that swap the dev build and the released plugin share one macro
store, and a tester who wipes the dev store wipes real work. The id must stay
stable: changing it abandons every macro saved under the old one.

## Local harnesses

`dev/harness/host-harness.html` fakes the Creator host — a fake `creator` global
with the fake scene from `engine/testing/fakeScene.ts`, the **real `plugin.js`**,
and the real UI iframe — so the full record→diff→playback loop runs in a plain
browser. The dev server compiles and serves `plugin.js` on request through
`@lottiefiles/vite-plugin-creator`, so the page always runs the source you just
edited and needs no build step. Drive it from the console via `window.harness`.
`dev/harness/sandbox-test.html` is narrower: it reproduces the opaque-origin sandbox
to test the no-`localStorage` / no-`randomUUID` paths.

`pnpm test:harness` drives the host harness in headless Chrome, and is the only
standing check that runs record and playback together. It shares its driver with
`pnpm test:ui` (`scripts/ui-probe/`) and reaches the panel through the sandboxed
iframe's own DevTools target, because Chrome isolates a sandboxed frame into its
own process. Each scenario reloads the page, so every one starts from the same
fake scene: it selects a layer, records an edit made through the fake proxies,
saves the macro, replays it onto other layers, and then asks the fake scene what
the values became. The layer the recording did not touch is asserted too — a
replay that writes too widely is as much a failure as one that writes nothing.

Vite serves plain HTTP, so use `http://localhost:5173`. `.claude/launch.json`
declares the same URL.

## Status and open threads (as of engine rev 2026-09-08.2)

- Motion-token (color token/slot) bindings: SETTLED — not observable,
  conclusively (`limitations.md`). Rev .51's record.start token hunt ran in two
  independent sessions (traces 2026-08-26T07-39-25/-52, 07-40-35): proxy
  chains carry only `{r,g,b}`, `node.data`/`shape.data` is the plugin's own
  empty storage, and `node.toJSON()`/`scene.toJSON()` are `{id,type}` STUBS
  on this host (`runtime-api.md` caveat — this also means the per-fill-opacity
  toJSON recovery finds nothing live). The hunt stays in the debug probe so a
  host that adds any surface shows up unchanged; the full ask (read a binding
  AND apply-by-reference) is upstream.
- Verification gap noted in the 08-26 triage sweep: `set-static` in
  sandbox/applier.ts has no post-write read-back (unlike `set-plain`, fixes
  #13/#20), so a host-swallowed absolute write is indistinguishable from a
  coincidental value match in probes. No trace shows it firing; watch for it.

- Nesting-from-selection: the MOVE API stays a CONFIRMED platform limitation
  (see `limitations.md` for the breadcrumb evidence and the upstream ask).
  The guess-chain is gone since rev `2026-09-06.1`: 1.0.1 settled what the
  dead rungs were, so replay makes ONE verified `createSceneLayer()` call and
  reports the outcome. A host that starts moving the selection into the
  created layer passes that verification and skips the rebuild with no code
  change. Since rev `2026-09-07.1` a refusal rebuilds the layers inside the
  new scene instead of reporting a false success — the three 2026-09-06T17-13
  traces showed adoption reading like a nest that never happened. The route
  runs on typed, not yet live-verified members (`runtime-api.md`).
- Baselined on `@lottiefiles/creator-api-types` 1.0.1 (2026-09-06). The typed
  surfaces this branch starts to use — `creator.utils.isLayer`, the `Scene`
  settings writes, `getValueAt` baselines, `createGroup(GroupOptions)`,
  `clientStorage.usedQuota`, and the nest rebuild's members (the inner
  scene's factories, `creator.createScene`, `createSceneLayer({ scene })`,
  `isNestableScene`, and `Scene.remove()`) — are all feature-detected and
  none is live-verified. `runtime-api.md` lists them under "Typed in 1.0.1, live
  verification pending"; move each one when a trace confirms it.
- Never live-verified yet: the interface-theme relay (`sandbox/theme.ts` —
  `creator.ui.theme` / `change:theme` per the ui-library docs,
  feature-detected, silent on hosts without it); the set-plain read-back
  DISCARD note (no host-discarded write has appeared in a ≥.41 trace);
  break-scene's fallback-restore path (live runs have only ever broken an
  EMPTY shell, so the rebuild-from-`fallback` branch is still untested).
  Set-plain text/font WRITES are live-verified (the .41 traces of
  2026-08-24T12:16 show real probe values applying).
- Live-verified 2026-08-26 (rev .51 seed-macro sweep): the `createTextLayer`
  rebuild — trace 08-15-26 built a REAL text layer with honest read-backs,
  the singular-fill remap and keyframes routed through
  `layerByRecordedId`. Mask add/edit replay is live-verified BROKEN (the
  applier only checked `addMask`; the host has only `createMask`) and fixed
  in rev .52 — pending a live re-verify. Nest-layers reconfirmed
  platform-blocked (08-15-14: the guess-chain exhausted every route and fell
  back with honest notes). v3.1 params + the configure-sheet edit are now
  live-verified in Creator (Parametric slide trace: the edited param value
  flowed through BOTH repeat passes), as are repeat compounding and
  disabled-step filtering in the same trace.
- Scene-layer reorder: the moveBefore/moveAfter mechanism executed live in
  08-15-02, but its outcome was unverifiable (scene ops probed `[]` on both
  sides) AND the payload was positions-only, so a foreign scene got
  reshuffled silently. Rev .52 gates it on recorded layer identities and
  adds the scene-summary probe that closes the audit gap; the reorder itself
  still needs one clean live confirmation. (`shiftTo` throws for both guessed
  signatures — see `runtime-api.md`.)
- Live-verified 2026-08-26 (rev .47–.49 trace sweep): whole-fill
  `replace-paint` replay INCLUDING the topology remap (recorded
  group-nested fill → flat target's root fill really replaced, trace
  04-04-16; recorded solid→gradient kind change replayed clean, 06-03
  session); relative-offset retarget math exact (04-05 session); the
  .48/.49 `selectionCount` rollout; the #14 recorded-nothing fallback.
  Fill swaps became VERIFIABLE in traces only at rev .50 (probe paint
  summaries, taxonomy #19) — earlier paint probes are null/null artifacts.
- Capture live status (2026-08-26): offer + "Add all" fully verified in
  five sessions (up to 198 steps, "Fish" → mismatched target, 0 failures,
  traces 2026-08-24T17-50…2026-08-25T05-27); "Add selected" blocked by
  the host — SETTLED both routes: the getter polls `array(0)` always,
  and the `selection:keyframes` event fires (311× in trace 06-03-22) with
  permanently empty payloads. `limitations.md` + taxonomy #17; upstream ask.
  The moment Creator populates either surface it lights up unchanged.
- Repeat-applying an offsets macro to the same layer compounds by design —
  now formalized as the Repeat ×N play option.
- v3.1 live status: at-playhead, stagger, and repeat verified in traces
  (2026-08-21T21-45-57-555, 2026-08-22T14-25-27-048; `timeline.currentFrame`
  IS readable). Repeat ×N on a keyframe-only macro is idempotent by design —
  keyframe steps converge to the same absolute frames/values each pass;
  compounding only happens through static transform offsets.
  Simplify is live-verified too (trace 2026-08-23T07-54-20-321: Macro 1
  collapsed 15 → 5 steps, replayed clean). Edit/disable and params are
  verified in the standalone UI (headless walk-through, see below) but not
  yet seen in a Creator trace.
- Rectangle corner roundness: filed in `limitations.md` (dead `roundness`
  proxy — always 0, edits produce empty ticks). Registry entry stays so a
  host fix lights up by itself.
- UI verification without the Chrome extension: a puppeteer-core driver
  (session scratchpad `drive/walk.mjs`, not in the repo) walks record →
  review (simplify/skip/edit/pin) → save → play options → configure sheet →
  playback against the standalone mock engine and asserts keyboard reach,
  live-region announcements, no horizontal overflow, and label widths at
  260/320px. Demo mode emits real StepPayloads precisely so this is possible
  — keep `mockRecorder.ts` on `buildStep`.
- A persistent Monitor task watches `traces/` during dev sessions; audited
  traces are appended to `traces/.processed` (the /triage-traces skill skips
  those).

