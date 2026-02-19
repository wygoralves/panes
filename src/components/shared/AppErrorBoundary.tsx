import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Keep a trace in the terminal running `tauri dev`.
    console.error("UI crash:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16 }}>
          <div className="surface" style={{ padding: 12, borderColor: "var(--danger)" }}>
            <p style={{ margin: 0, fontWeight: 700 }}>UI runtime error</p>
            <pre
              style={{
                margin: "8px 0 0",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                color: "var(--text-soft)"
              }}
            >
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
