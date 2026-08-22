import { Button } from "@lottiefiles/creator-plugins-ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import type { MockPlaybackGateway, PlaybackScenario } from "../gateways/mockPlayback";
import type { MockRecorderGateway, RecorderScenario } from "../gateways/mockRecorder";
import type { MacroStore } from "../gateways/types";
import type { Macro } from "../types";
import { newId } from "../utils/id";

const SEED_MACROS: Array<Omit<Macro, "id" | "createdAt">> = [
  {
    name: "Bounce in",
    steps: [
      { id: "", kind: "transform", label: "Transform · y → -120", payload: {} },
      { id: "", kind: "keyframe", label: "Keyframe · position @ frame 0", payload: {} },
      { id: "", kind: "keyframe", label: "Keyframe · position @ frame 30", payload: {} },
      { id: "", kind: "layer", label: "Layer · opacity → 100%", payload: {} },
    ],
  },
  {
    name: "Brand recolor with a very long name that truncates",
    steps: [
      { id: "", kind: "fill", label: "Fill → #FF5A00", payload: {} },
      { id: "", kind: "stroke", label: "Stroke → #002B49 · width → 3", payload: {} },
    ],
  },
  {
    name: "Spin + fade",
    steps: [
      { id: "", kind: "transform", label: "Transform · rotation → 360°", payload: {} },
      { id: "", kind: "keyframe", label: "Keyframe · rotation @ frame 60", payload: {} },
      { id: "", kind: "layer", label: "Layer · opacity → 0%", payload: {} },
      { id: "", kind: "keyframe", label: "Keyframe · opacity @ frame 60", payload: {} },
      { id: "", kind: "other", label: "Precomp · time remap → 0.5×", payload: {} },
    ],
  },
];

export interface DebugStripProps {
  mockRecorder: MockRecorderGateway;
  mockPlayback: MockPlaybackGateway;
  store: MacroStore;
  onStoreChanged: () => void;
}

/** Dev-only controls to reach every UI state without the Creator API. */
export function DebugStrip({
  mockRecorder,
  mockPlayback,
  store,
  onStoreChanged,
}: DebugStripProps) {
  const [open, setOpen] = useState(false);
  const [recScenario, setRecScenario] = useState<RecorderScenario>("burst");
  const [playScenario, setPlayScenario] = useState<PlaybackScenario>("pass");

  async function seed() {
    for (const seedMacro of SEED_MACROS) {
      await store.save({
        ...seedMacro,
        id: newId(),
        createdAt: Date.now(),
        steps: seedMacro.steps.map((step) => ({
          ...step,
          id: newId(),
        })),
      });
    }
    onStoreChanged();
  }

  async function clear() {
    const macros = await store.list();
    for (const macro of macros) await store.remove(macro.id);
    onStoreChanged();
  }

  return (
    <div className="border-t border-dashed border-border bg-muted/60 text-11">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-3 py-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="instrument">Dev tools</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="press key key-outline"
              onClick={() => void seed()}
            >
              Seed 3
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="press key key-outline"
              onClick={() => void clear()}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="press key key-outline"
              onClick={() => mockRecorder.emitNow()}
            >
              Emit step
            </Button>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="instrument">Recorder</span>
            <select
              className="rounded border border-input bg-background px-1 py-0.5 text-11"
              value={recScenario}
              onChange={(event) => {
                const value = event.target.value as RecorderScenario;
                setRecScenario(value);
                mockRecorder.setScenario(value);
              }}
            >
              <option value="burst">Short burst (6 steps)</option>
              <option value="long">Long (20 steps)</option>
              <option value="silent">Silent (0 steps)</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="instrument">Playback</span>
            <select
              className="rounded border border-input bg-background px-1 py-0.5 text-11"
              value={playScenario}
              onChange={(event) => {
                const value = event.target.value as PlaybackScenario;
                setPlayScenario(value);
                mockPlayback.setScenario(value);
              }}
            >
              <option value="pass">All steps pass</option>
              <option value="fail-step-3">Fail at step 3</option>
              <option value="no-selection">No selection</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
