import { useEffect, useId, useRef, useState } from "react";
import { NavigationIcon } from "./SidebarIcons";

export default function UserMenu({ user, onNavigate, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = useId();
  const name =
    user?.fullName || user?.userName || user?.username || "User";
  const roleLabel = user?.roleName || user?.role || "";

  useEffect(() => {
    const close = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className={`user-menu ${open ? "is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`user-menu-btn ${open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setTimeout(
              () => ref.current?.querySelector('[role="menuitem"]')?.focus(),
              0
            );
          }
        }}
      >
        <span className="user-menu-name">{name}</span>
        {roleLabel ? <span className="user-menu-role">{roleLabel}</span> : null}
        <span className="nav-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="menu-panel user-menu-panel"
          id={menuId}
          role="menu"
          onKeyDown={(event) => {
            const els = Array.from(
              ref.current?.querySelectorAll('[role="menuitem"]') || []
            );
            const i = els.indexOf(document.activeElement);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              els[(i + 1) % els.length]?.focus();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              els[(i - 1 + els.length) % els.length]?.focus();
            } else if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="menu-header" role="presentation">
            <span className="menu-header-name">{name}</span>
            {roleLabel ? (
              <span className="menu-header-meta">{roleLabel}</span>
            ) : null}
          </div>
          <div className="menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate("change-password");
            }}
          >
            <NavigationIcon name="key" className="menu-item-icon" />
            <span className="menu-item-text">Change Password</span>
          </button>
          <div className="menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <NavigationIcon name="logout" className="menu-item-icon" />
            <span className="menu-item-text">Logout</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
