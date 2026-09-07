import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * The last line of defence under the panel. React unmounts the whole tree
 * when a render throws, and inside Creator that is a blank white panel with
 * no console the user can see. A stored macro the current build does not
 * understand is the realistic trigger, and one bad row must not take the
 * deck, the list, and the recorder with it. This boundary says what
 * happened and how to recover, in plain text; the skin does not get a say
 * because the skin may be what failed.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[macro-recorder] panel render failed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div role="alert" style={{ padding: 16, fontSize: 12, lineHeight: 1.5 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Macro Recorder stopped drawing.</p>
        <p style={{ margin: "4px 0 0" }}>
          Close the panel and open it again. If it happens on the same macro every time, that macro
          was saved by a build this one can't read: delete it, or export the others and reinstall.
        </p>
        <p style={{ margin: "8px 0 0", fontFamily: "monospace", opacity: 0.7 }}>
          {this.state.message}
        </p>
      </div>
    );
  }
}
