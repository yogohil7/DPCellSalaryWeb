import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import "./notifications.css";

/*
  A small, dependency-free notification system.

  WHY: the application currently reports ordinary success and failure with
  window.alert(), which blocks the whole UI for a message that needs no
  decision. This provides a non-blocking, dismissible, accessible
  alternative. It is ADDITIVE — nothing is rewired here; screens adopt it
  as they are upgraded, and any alert() that acts as a genuine confirmation
  step for a destructive action is deliberately left alone, because a toast
  cannot ask a question.

  Accessibility: the container is a polite live region so a screen reader
  announces a message without stealing focus; errors use assertive. Every
  toast is dismissible by button and by keyboard.
*/

const NotificationContext = createContext(null);

const DEFAULT_TIMEOUT = { success: 4000, info: 4000, warning: 6000, error: 0 };

let nextId = 0;

export function NotificationProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message, options = {}) => {
      const type = options.type || "info";
      const id = ++nextId;
      const timeout =
        options.timeout != null ? options.timeout : DEFAULT_TIMEOUT[type] ?? 4000;

      setItems((list) => [
        ...list,
        { id, type, message: String(message ?? ""), title: options.title || "" },
      ]);

      /* An error stays until dismissed: a failure the user missed is worse
         than one they have to close. */
      if (timeout > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), timeout)
        );
      }
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      notify,
      dismiss,
      success: (m, o) => notify(m, { ...o, type: "success" }),
      error: (m, o) => notify(m, { ...o, type: "error" }),
      warning: (m, o) => notify(m, { ...o, type: "warning" }),
      info: (m, o) => notify(m, { ...o, type: "info" }),
    }),
    [notify, dismiss]
  );

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <div className="dp-toast-region" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div
            key={item.id}
            className={`dp-toast dp-toast-${item.type}`}
            role={item.type === "error" ? "alert" : "status"}
          >
            <span className="dp-toast-mark" aria-hidden="true">
              {item.type === "success"
                ? "✓"
                : item.type === "error"
                ? "!"
                : item.type === "warning"
                ? "▲"
                : "i"}
            </span>
            <div className="dp-toast-body">
              {item.title ? <strong>{item.title}</strong> : null}
              <span>{item.message}</span>
            </div>
            <button
              type="button"
              className="dp-toast-close"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

/*
  Safe outside a provider: returns a no-op-ish API that falls back to the
  console, so a screen can adopt the hook before the provider is mounted
  everywhere without throwing.
*/
export function useNotifications() {
  const ctx = useContext(NotificationContext);
  return (
    ctx || {
      notify: (m) => console.info("[notify]", m),
      dismiss: () => {},
      success: (m) => console.info("[success]", m),
      error: (m) => console.error("[error]", m),
      warning: (m) => console.warn("[warning]", m),
      info: (m) => console.info("[info]", m),
    }
  );
}

export default NotificationProvider;
