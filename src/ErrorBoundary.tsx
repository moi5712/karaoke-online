import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("App render failed:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-surface-base text-text-primary p-4">
          <div className="max-w-sm w-full bg-surface-panel rounded-2xl p-4 space-y-2 text-center">
            <p className="text-sm font-bold">畫面發生錯誤</p>
            <p className="text-xs text-text-muted">已攔截異常，避免整頁黑屏。請重新整理頁面恢復。</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full h-9 rounded-xl bg-interactive-primary hover:bg-interactive-primary-hover text-white text-xs font-bold transition-colors duration-normal ease-default"
            >
              重新整理
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
