import { Button, cn } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import { useApp } from "../state/AppContext";
import type { PlayingState } from "../state/appReducer";
import { CopyJsonDialog, type CopyJsonPayload } from "./CopyJsonDialog";
import { ImportButton } from "./ImportButton";
import { MacroRow } from "./MacroRow";
import { isExactActivation, isExactModifier, useExactModifierHover } from "./recordModifier";

export interface MacroListProps {
  /** Present while a macro is playing (idle rows stay visible but locked). */
  playing: PlayingState | null;
}

export function MacroList({ playing }: MacroListProps) {
  const { state, actions } = useApp();
  const macros = state.macros;
  // Until the store has answered, an empty list means "not known yet". Every
  // other mode is reached from an idle state the store already answered for.
  const loaded = state.mode !== "idle" || state.loaded;
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
            the uppercase is CSS.
            The well is drawn from the first paint; its words wait for the
            store. "No macros yet" used to flash on every panel open, in
            front of a list that was about to arrive. `invisible` rather
            than an unmount, so the well cannot change height under the
            reader — and a hidden key is out of the tab order with its
            copy. */}
        <div className="rack flex flex-col items-center gap-1.5 px-6 py-9 text-center">
          {/* A miniature of the hero's reel window — bezel, two reels, the
              tape run between them. Bare circles read as a face; the
              enclosing window is what makes them reels. */}
          <svg viewBox="0 0 56 26" className="h-6 w-14 text-[color:var(--label-fg)]" aria-hidden>
            <rect
              x="1"
              y="1"
              width="54"
              height="24"
              rx="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="18" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="18" cy="13" r="1.75" fill="currentColor" />
            <circle cx="38" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="38" cy="13" r="1.75" fill="currentColor" />
            <path d="M24 13h8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <p
            className={cn(
              "mono mt-1 text-12 font-semibold uppercase tracking-[0.06em] text-foreground",
              !loaded && "invisible",
            )}
          >
            No macros yet
          </p>
          <p
            className={cn(
              "max-w-[30ch] text-12 leading-snug text-pretty text-muted-foreground",
              !loaded && "invisible",
            )}
          >
            Record your edits, then stop to save them as a macro you can replay.
          </p>
          <EmptyStateRecordKey
            hidden={!loaded}
            onRecord={(options) => actions.startRecording(options)}
          />
        </div>
      </div>
    );
  }

  const idle = state.mode === "idle" ? state : null;
  // Expansion survives play/configure so the running step can be watched.
  const expandedId =
    state.mode === "recording" || state.mode === "reviewing" ? null : state.expandedId;

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
        onCopied={(name) => actions.notify(`Copied “${name}” as JSON`, "success")}
      />
    </div>
  );
}

/**
 * The empty rack's Record key — the panel's second Record entry point, and it
 * takes the same Option/Alt modifier the deck's transport key takes: a user who has
 * never recorded is the one most likely to want a placement macro, and a
 * modifier that works on one key and not the other is a trap.
 *
 * Its own component so the hover state re-renders one key, not the whole list.
 */
function EmptyStateRecordKey({
  hidden,
  onRecord,
}: {
  hidden: boolean;
  onRecord: (options: { exact: boolean }) => void;
}) {
  const exactModifier = useExactModifierHover();
  return (
    <Button
      size="sm"
      className={cn(
        "press key mt-2.5",
        exactModifier.held ? "key-blue" : "key-red",
        hidden && "invisible",
      )}
      {...exactModifier.handlers}
      onClick={(event) => onRecord({ exact: isExactModifier(event) })}
      onKeyDown={(event) => {
        if (!isExactActivation(event)) return;
        event.preventDefault();
        onRecord({ exact: true });
      }}
    >
      <span className="key-dot" aria-hidden>
        <span />
      </span>
      Record
    </Button>
  );
}
