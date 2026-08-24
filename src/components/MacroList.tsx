import { Button } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import { useApp } from "../state/AppContext";
import type { PlayingState } from "../state/appReducer";
import { CopyJsonDialog, type CopyJsonPayload } from "./CopyJsonDialog";
import { ImportButton } from "./ImportButton";
import { MacroRow } from "./MacroRow";

export interface MacroListProps {
  /** Present while a macro is playing (idle rows stay visible but locked). */
  playing: PlayingState | null;
}

export function MacroList({ playing }: MacroListProps) {
  const { state, actions } = useApp();
  const macros = state.macros;
  // Set when Copy JSON found every clipboard route denied (Creator's
  // opaque-origin iframe) — the dialog offers the JSON for a manual copy.
  const [copyFallback, setCopyFallback] = useState<CopyJsonPayload | null>(null);

  // The totals used to live in a dedicated footer below the list — one more
  // border, one more row of chrome, for two numbers that fit next to the
  // section label just as well.
  const totalSteps = macros.reduce((sum, macro) => sum + macro.steps.length, 0);
  // A two-number readout ("4 · 12"), like the rows' own two-digit counts:
  // the visible text carries no words at all, so it can be nowrap and NEVER
  // mid-word-ellipsizes ("12 ste…") on a narrow panel. The words ride along
  // for assistive tech and the pointer (title).
  const countsShort = `${macros.length} · ${totalSteps}`;
  const countsFull = `${macros.length === 1 ? "1 macro" : `${macros.length} macros`} · ${
    totalSteps === 1 ? "1 step" : `${totalSteps} steps`
  }`;

  // The section label doubles as the shelf Import belongs on: importing is
  // adding to this list, not a panel-wide utility.
  const header = (
    <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-1">
      <span className="flex min-w-0 items-baseline gap-1.5">
        {/* The section label always wins the space fight — the counts
            beside it are the part that gives way (truncates) if the row
            gets tight, never the label that names it. */}
        <span className="instrument shrink-0">Saved macros</span>
        {macros.length > 0 && (
          <span
            className="mono shrink-0 whitespace-nowrap text-10 text-muted-foreground tabular-nums"
            title={countsFull}
          >
            <span aria-hidden>{countsShort}</span>
            <span className="sr-only">{countsFull}</span>
          </span>
        )}
      </span>
      <ImportButton onImport={actions.importJson} />
    </div>
  );

  if (macros.length === 0) {
    return (
      <div className="p-2">
        {header}
        {/* The empty rack IS the empty state: the same well the macros will
            land in, wearing the console's own type — a mono readout title,
            a two-reel motif echoing the hero, and the deck's record glyph
            on the one red key this surface gets. Copy stays natural case;
            the uppercase is CSS. */}
        <div className="rack flex flex-col items-center gap-1.5 px-6 py-9 text-center">
          {/* A miniature of the hero's reel window — bezel, two reels, the
              tape run between them. Bare circles read as a face; the
              enclosing window is what makes them reels. */}
          <svg
            viewBox="0 0 56 26"
            className="h-6 w-14 text-[color:var(--label-fg)]"
            aria-hidden
          >
            <rect x="1" y="1" width="54" height="24" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="18" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="18" cy="13" r="1.75" fill="currentColor" />
            <circle cx="38" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="38" cy="13" r="1.75" fill="currentColor" />
            <path d="M24 13h8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <p className="mono mt-1 text-12 font-semibold uppercase tracking-[0.06em] text-foreground">
            No macros yet
          </p>
          <p className="max-w-[30ch] text-12 leading-snug text-pretty text-muted-foreground">
            Record your edits, then stop to save them as a macro you can replay.
          </p>
          <Button
            size="sm"
            className="press key key-red mt-2.5"
            onClick={() => actions.startRecording()}
          >
            <span className="key-dot" aria-hidden>
              <span />
            </span>
            Record
          </Button>
        </div>
      </div>
    );
  }

  const idle = state.mode === "idle" ? state : null;
  // Expansion survives play/configure so the running step can be watched.
  const expandedId = state.mode === "recording" || state.mode === "reviewing" ? null : state.expandedId;

  return (
    <div className="p-2">
      {header}
      <ul className="rack flex flex-col" data-testid="macro-list">
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
            onCopyJson={() =>
              void actions.copyMacroJson(macro.id).then((payload) => {
                if (payload) setCopyFallback(payload);
              })
            }
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
      <CopyJsonDialog
        payload={copyFallback}
        onClose={() => setCopyFallback(null)}
        onCopied={(name) => actions.notify(`Copied "${name}" as JSON`, "success")}
      />
    </div>
  );
}
