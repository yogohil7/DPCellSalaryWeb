import React from "react";

/**
 * Catches a render/runtime error inside a page module.
 *
 * Without this, any exception thrown while rendering a page unmounts the
 * whole React tree and the user simply sees a blank white screen with no
 * indication of what happened. This turns that into a readable message and
 * keeps the rest of the shell (header, back navigation) usable.
 */
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[PageErrorBoundary] ${this.props.pageId || "page"} failed to render:`,
      error,
      info?.componentStack
    );
  }

  componentDidUpdate(prevProps) {
    /* Leaving a broken page clears the error so the next one renders. */
    if (prevProps.pageId !== this.props.pageId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          margin: "16px",
          padding: "16px 18px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 4,
          color: "#7f1d1d",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          This page could not be displayed.
        </div>
        <div style={{ marginBottom: 10 }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onBack?.();
          }}
          style={{
            height: 30,
            padding: "0 14px",
            borderRadius: 3,
            border: "1px solid #b91c1c",
            background: "#ffffff",
            color: "#7f1d1d",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ← Back to Home
        </button>
      </div>
    );
  }
}
