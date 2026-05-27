import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: "2rem", color: "#f87171" }}>
            <strong>렌더링 오류가 발생했습니다.</strong>
            <pre style={{ marginTop: "1rem", fontSize: "0.8rem", opacity: 0.7 }}>
              {this.state.error.message}
            </pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
