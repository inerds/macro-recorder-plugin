import { Button, EmptyState } from "@lottiefiles/creator-plugins-ui";
import { Circle, ListVideo } from "lucide-react";

import { useApp } from "../state/AppContext";
import type { PlayingState } from "../state/appReducer";
import { MacroRow } from "./MacroRow";

export interface MacroListProps {
  /** Present while a macro is playing (idle rows stay visible but locked). */
  playing: PlayingState | null;
}

export function MacroList({ playing }: MacroListProps) {
  const { state, actions } = useApp();
  const macros = state.macros;

  if (macros.length === 0) {
    return (
      <EmptyState
        className="py-10"
        icon={<ListVideo className="size-8" aria-hidden />}
        title="No macros yet"
        description="Press Record, edit your animation, then press Stop to save the steps as a reusable macro."
        action={
          <Button size="sm" onClick={() => actions.startRecording()}>
            <Circle
              className="size-3 fill-current text-destructive"
              aria-hidden
            />
            Record
          </Button>
        }
      />
    );
  }

  const idle = state.mode === "idle" ? state : null;

  return (
    <ul className="flex flex-col gap-1.5 p-2" data-testid="macro-list">
      {macros.map((macro) => (
        <MacroRow
          key={macro.id}
          macro={macro}
          expanded={idle?.expandedId === macro.id}
          renaming={idle?.renamingId === macro.id}
          confirmingDelete={idle?.confirmingDeleteId === macro.id}
          justPlayed={idle?.justPlayedId === macro.id}
          playing={playing?.macroId === macro.id ? playing : null}
          playDisabled={playing !== null}
          onToggleExpand={() => actions.toggleExpand(macro.id)}
          onPlay={() => actions.play(macro.id)}
          onRenameStart={() => actions.startRename(macro.id)}
          onRenameCommit={(name) => actions.commitRename(macro.id, name)}
          onRenameCancel={() => actions.cancelRename()}
          onDuplicate={() => actions.duplicateMacro(macro.id)}
          onExport={() => actions.exportMacro(macro.id)}
          onDeleteRequest={() => actions.requestDelete(macro.id)}
          onDeleteCancel={() => actions.cancelDelete()}
          onDeleteConfirm={() => actions.confirmDelete(macro.id)}
          onDeleteStep={(stepId) => actions.deleteMacroStep(macro.id, stepId)}
          onResolveFailure={(action) => actions.resolvePlaybackFailure(action)}
        />
      ))}
    </ul>
  );
}
