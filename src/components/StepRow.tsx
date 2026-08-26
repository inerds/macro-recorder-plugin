import {
  Check,
  Circle,
  CircleAlert,
  CircleSlash,
  Diamond,
  Eye,
  EyeOff,
  Layers,
  Move,
  PaintBucket,
  PenLine,
  Pencil,
  Pin,
  Shapes,
  Scissors,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

import { editableValueOf, type EditableValue } from "../../shared/editing";
import type { PlayStepStatus } from "../state/stepStatus";
import type { MacroStep, StepKind } from "../types";
import { StepValueEditor } from "./StepValueEditor";

const KIND_ICONS: Record<StepKind, typeof Move> = {
  transform: Move,
  fill: PaintBucket,
  stroke: PenLine,
  keyframe: Diamond,
  layer: Layers,
  shape: Shapes,
  mask: Scissors,
  other: Circle,
};

/**
 * Row action. Always mounted and tabbable — only its opacity changes — so a
 * hovered row never reflows, and touch devices (no hover) always show them.
 */
const ACTION_CLASS =
  "flex h-6 w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[7px] text-muted-foreground opacity-0 transition-[opacity,background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none hover:bg-secondary hover:text-foreground active:scale-[0.96] focus-visible:w-6 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover:w-6 group-hover:opacity-100 group-focus-within:w-6 group-focus-within:opacity-100 [@media(hover:none)]:w-6 [@media(hover:none)]:opacity-100";
// Hidden actions collapse to w-0 at rest so a pinned/skipped row's resting
// lane is only as wide as its STATE icons — the lane's bg-inherit used to
// span all four buttons and paint over the label's tail. The lane is
// absolute, so expanding on hover/focus reflows nothing outside it.

/**
 * The lane the actions live in. Absolute, so it costs the label no width: it
 * floats over the row's tail on hover and paints `bg-inherit` behind itself.
 * `pointer-events-none` hides it from the mouse at rest without taking the
 * buttons out of the tab order.
 */
const LANE_CLASS =
  "absolute end-1 top-0 bottom-0 flex items-center gap-0.5 bg-inherit pl-2";
const LANE_HIDDEN =
  "pointer-events-none opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto";
/** A pinned or skipped row shows its state icon at rest, so the lane stays. */
const LANE_SHOWN = "pointer-events-auto opacity-100";

/** Both eye glyphs stay mounted and cross-fade, so the button never jumps. */
const EYE_ICON_CLASS =
  "col-start-1 row-start-1 size-3.5 transition-[opacity,scale,filter] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";

export interface StepRowProps {
  step: MacroStep;
  index: number;
  onDelete?: (stepId: string) => void;
  /** Enable/disable the step for playback. */
  onToggle?: (stepId: string) => void;
  /** Commit a new value for an editable step. */
  onEdit?: (stepId: string, value: EditableValue) => void;
  /** Pin/unpin the step as a macro parameter. */
  onToggleParam?: (stepId: string) => void;
  /** This step is currently pinned as a parameter. */
  param?: boolean;
  /** Highlight as the currently-running playback step. */
  active?: boolean;
  /**
   * Where this step is in a paced run. Absent outside the playing macro's
   * card; a skipped step never gets one (it isn't part of the run).
   */
  status?: PlayStepStatus;
  /** A "Layer · " prefix shared by the whole list, shown once in its header. */
  hidePrefix?: string;
}

export function StepRow({
  step,
  index,
  onDelete,
  onToggle,
  onEdit,
  onToggleParam,
  param,
  active,
  status,
  hidePrefix = "",
}: StepRowProps) {
  const shownLabel =
    hidePrefix && step.label.startsWith(hidePrefix) ? step.label.slice(hidePrefix.length) : step.label;
  // Truncation must not eat the step's RESULT: "Stroke · color #000000 →
  // #002B…" hides the one token that matters. Split at the last arrow — the
  // head (property · before) gives way, the "→ after" tail stays whole, and
  // the title still carries the full label.
  const arrowAt = shownLabel.lastIndexOf(" → ");
  const labelHead = arrowAt === -1 ? shownLabel : shownLabel.slice(0, arrowAt);
  const labelTail = arrowAt === -1 ? null : shownLabel.slice(arrowAt);
  const Icon = KIND_ICONS[step.kind];
  const [draft, setDraft] = useState<EditableValue | null>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);

  const editable = editableValueOf(step);
  const disabled = step.disabled === true;
  const editing = draft !== null;
  // The live recording feed passes no handlers: no lane, no wasted width.
  const hasActions = Boolean(onDelete || onToggle || onEdit || onToggleParam);
  // A pin or a struck-through eye is state, not an action: it has to survive
  // the lane's resting fade, and the lane's background with it.
  const laneAtRest =
    (param === true && Boolean(onToggleParam) && editable !== null) ||
    (disabled && Boolean(onToggle));

  const commit = () => {
    if (draft && onEdit) onEdit(step.id, draft);
    setDraft(null);
  };

  /** Editing is a detour, not a destination — hand focus back to the pencil. */
  const restoreFocus = () => {
    queueMicrotask(() => pencilRef.current?.focus());
  };

  return (
    <li
      className={`group relative flex min-h-[26px] items-center gap-1.5 px-2 text-12 ${
        // A failed step is marked, not current: it keeps the row's own ground
        // and swaps the inset bar to the small-text red.
        status === "failed"
          ? "bg-inherit text-foreground shadow-[inset_2px_0_0_var(--ink-red-text)]"
          : active
            ? "bg-accent text-accent-foreground shadow-[inset_2px_0_0_var(--primary)]"
            : "bg-inherit text-foreground"
      }`}
      aria-current={active ? "step" : undefined}
      data-status={status}
      data-testid="step-row"
    >
      {/* The numeral slot doubles as the run's result glyph — a done step's
          number has served its purpose, and the check lands where the eye
          already is. The state is also in the sr-only suffix below, so the
          glyph is never the only channel. */}
      <span className="step-num mono w-5 shrink-0 text-end text-10 text-muted-foreground">
        {status === "done" ? (
          <Check className="inline size-3 align-[-1px]" strokeWidth={2.5} aria-hidden />
        ) : status === "failed" ? (
          <CircleAlert
            className="inline size-3 align-[-1px] text-[color:var(--ink-red-text)]"
            strokeWidth={2.5}
            aria-hidden
          />
        ) : (
          index + 1
        )}
      </span>
      <Icon
        className={`size-3.5 shrink-0 ${
          disabled ? "text-muted-foreground/70" : "text-muted-foreground"
        }`}
        // 2px, not 2.5 — the icon carries the 12px regular label's weight.
        strokeWidth={2}
        aria-hidden
      />

      {editing ? (
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              restoreFocus();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              restoreFocus();
            }
          }}
          // Moving between the editor's own fields (hex + swatch, x + y) must
          // not commit; leaving the editor entirely does. Focus is NOT
          // restored here — the user is already on their way elsewhere.
          // One exception: the native color picker is a separate OS window,
          // so opening it blurs the PAGE (relatedTarget null) without the
          // user leaving the editor — committing then would unmount the
          // editor mid-pick and the chosen color would land nowhere. A blur
          // while the document itself has lost focus is never "moved on".
          onBlur={(event) => {
            if (!document.hasFocus()) return;
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              commit();
            }
          }}
        >
          <StepValueEditor
            value={draft}
            onChange={setDraft}
            label={`New value for step ${index + 1}`}
            autoFocus
          />
        </span>
      ) : (
        <span
          className={`flex min-w-0 flex-1 items-baseline ${
            disabled ? "text-muted-foreground line-through" : ""
          } ${laneAtRest ? "pe-14" : ""}`}
          title={step.label}
        >
          {/* The tail (the result — the half worth keeping) is capped at
              60% and floored at ~9ch, so the head always keeps >=40% of the
              line and never crushes to "Tr…". No min-width on the head — a
              min INFLATES short heads and opens a gap before the arrow. */}
          <span className="min-w-0 truncate whitespace-pre">{labelHead}</span>
          {labelTail && (
            <span className="min-w-[9ch] max-w-[60%] truncate whitespace-pre">{labelTail}</span>
          )}
          {disabled && <span className="sr-only"> (skipped)</span>}
          {param && <span className="sr-only"> (parameter)</span>}
          {status === "done" && <span className="sr-only"> (completed)</span>}
          {status === "failed" && <span className="sr-only"> (failed)</span>}
        </span>
      )}

      {step.replayable === false && (
        <span
          className="flex shrink-0 items-center"
          title="Skipped — Creator can't replay this action"
        >
          <CircleSlash
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2.5}
            role="img"
            aria-label="Skipped — Creator can't replay this action"
          />
          <span className="sr-only">
            Creator's plugin API can't perform this action, so playback skips it.
          </span>
        </span>
      )}

      {/* Absent entirely in the recording feed, where there is nothing to
          reveal. */}
      {!editing && hasActions && (
        <span className={`${LANE_CLASS} ${laneAtRest ? LANE_SHOWN : LANE_HIDDEN}`}>
          {onToggleParam && editable && (
            <button
              type="button"
              className={`${ACTION_CLASS} ${
                param ? "w-6 pointer-events-auto opacity-100 text-foreground" : ""
              }`}
              aria-pressed={param === true}
              aria-label={`Ask for step ${index + 1}'s value on every play`}
              title={`Ask for step ${index + 1}'s value on every play`}
              onClick={() => onToggleParam(step.id)}
            >
              <Pin
                className="size-3.5 transition-[fill,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
                strokeWidth={2.5}
                fill={param ? "currentColor" : "transparent"}
              />
            </button>
          )}

          {onEdit && editable && (
            <button
              type="button"
              ref={pencilRef}
              className={ACTION_CLASS}
              aria-label={`Edit step ${index + 1}`}
              title={`Edit step ${index + 1}`}
              onClick={() => setDraft(editable)}
            >
              <Pencil className="size-3.5" strokeWidth={2.5} />
            </button>
          )}

          {onToggle && (
            <button
              type="button"
              className={`${ACTION_CLASS} ${
                disabled ? "w-6 pointer-events-auto opacity-100" : ""
              }`}
              aria-pressed={disabled}
              aria-label={`Skip step ${index + 1} during playback`}
              title={`Skip step ${index + 1} during playback`}
              onClick={() => onToggle(step.id)}
            >
              <span className="relative grid size-3.5 place-items-center">
                <EyeOff
                  className={EYE_ICON_CLASS}
                  strokeWidth={2.5}
                  style={{
                    opacity: disabled ? 1 : 0,
                    scale: disabled ? "1" : "0.25",
                    filter: disabled ? "blur(0px)" : "blur(4px)",
                  }}
                  aria-hidden
                />
                <Eye
                  className={EYE_ICON_CLASS}
                  strokeWidth={2.5}
                  style={{
                    opacity: disabled ? 0 : 1,
                    scale: disabled ? "0.25" : "1",
                    filter: disabled ? "blur(4px)" : "blur(0px)",
                  }}
                  aria-hidden
                />
              </span>
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              className={ACTION_CLASS}
              aria-label={`Delete step ${index + 1}`}
              title={`Delete step ${index + 1}`}
              // StepList re-aims focus at the neighbouring row's delete
              // button once this row is gone.
              data-step-action="delete"
              onClick={() => onDelete(step.id)}
            >
              <Trash2 className="size-3.5" strokeWidth={2.5} />
            </button>
          )}
        </span>
      )}
    </li>
  );
}
