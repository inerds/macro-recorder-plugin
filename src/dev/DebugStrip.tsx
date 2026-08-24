import { Button } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import type { MockPlaybackGateway, PlaybackScenario } from "../gateways/mockPlayback";
import type { MockRecorderGateway, RecorderScenario } from "../gateways/mockRecorder";

export interface DebugStripProps {
  mockRecorder: MockRecorderGateway;
  mockPlayback: MockPlaybackGateway;
}

/**
 * Mock-scenario controls to reach every UI state without the Creator API
 * (mock gateways only). Rendered as a section inside DevSettings; store
 * seeding/clearing lives there so it also works inside Creator.
 */
export function DebugStrip({
  mockRecorder,
  mockPlayback,
}: DebugStripProps) {
  const [recScenario, setRecScenario] = useState<RecorderScenario>("burst");
  const [playScenario, setPlayScenario] = useState<PlaybackScenario>("pass");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="instrument">Mock scenarios</span>
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
  );
}
