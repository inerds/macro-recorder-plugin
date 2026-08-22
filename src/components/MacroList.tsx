import { Button, EmptyState } from "@lottiefiles/creator-plugins-ui";
import { ListVideo } from "lucide-react";

import { useApp } from "../state/AppContext";
import type { PlayingState } from "../state/appReducer";
import { ImportButton } from "./ImportButton";
import { MacroRow } from "./MacroRow";

export interface MacroListProps {
  /** Present while a macro is playing (idle rows stay visible but locked). */
  playing: PlayingState | null;
}

export function MacroList({ playing }: MacroListProps) {
  const { state, actions } = useApp();
  const macros = state.macros;

  // The section label doubles as the shelf Import belongs on: importing is
  // adding to this list, not a panel-wide utility.
  const header = (
    <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-1">
      <span className="instrument truncate">Saved macros</span>
      <ImportButton onFile={actions.importFile} />
    </div>
  );

  if (macros.length === 0) {
    return (
      <div className="p-2">
        {header}
        <EmptyState
          className="px-6 py-10 [&>p]:max-w-[32ch]"
          icon={<ListVideo className="size-8" aria-hidden />}
          title="No macros yet"
          description="Record your edits, then stop to save them as a macro you can replay."
          action={
            <Button
              size="sm"
              className="press key key-red"
              onClick={() => actions.startRecording()}
            >
              <span
                className="grid size-3 shrink-0 place-items-center rounded-full border border-current"
                aria-hidden
              >
                <span className="size-1.5 rounded-full bg-current" />
              </span>
              Record
            </Button>
          }
        />
      </div>
    );
  }

  const idle = state.mode === "idle" ? state : null;
  // Expansion survives play/configure so the running step can be watched.
  const expandedId = state.mode === "recording" || state.mode === "reviewing" ? null : state.expandedId;

  return (
    <div className="p-2">
      {header}
      <ul className="flex flex-col gap-2" data-testid="macro-list">
        {macros.map((macro, index) => (
          <MacroRow
            key={macro.id}
            macro={macro}
            index={index}
            expanded={expandedId === macro.id}
            renaming={idle?.renamingId === macro.id}
            confirmingDelete={idle?.confirmingDeleteId === macro.id}
            justPlayed={idle?.justPlayedId === macro.id}
            playing={playing?.macroId === macro.id ? playing : null}
            playDisabled={playing !== null}
            onToggleExpand={() => actions.toggleExpand(macro.id)}
            onPlay={(options) => actions.play(macro.id, options)}
            onRenameStart={() => actions.startRename(macro.id)}
            onRenameCommit={(name) => actions.commitRename(macro.id, name)}
            onRenameCancel={() => actions.cancelRename()}
            onDuplicate={() => actions.duplicateMacro(macro.id)}
            onExport={() => actions.exportMacro(macro.id)}
            onDeleteRequest={() => actions.requestDelete(macro.id)}
            onDeleteCancel={() => actions.cancelDelete()}
            onDeleteConfirm={() => actions.confirmDelete(macro.id)}
            onDeleteStep={(stepId) => actions.deleteMacroStep(macro.id, stepId)}
            onSimplify={() => actions.simplifyMacro(macro.id)}
            onToggleStep={(stepId) => actions.toggleMacroStep(macro.id, stepId)}
            onEditStep={(stepId, value) => actions.editMacroStep(macro.id, stepId, value)}
            onToggleParam={(stepId) => actions.toggleMacroParam(macro.id, stepId)}
            onResolveFailure={(action) => actions.resolvePlaybackFailure(action)}
          />
        ))}
      </ul>
    </div>
  );
}
