import { useEffect, useId, useRef, useState } from "react";

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
        }}
      >
        <span className="user-menu-name">{name}</span>
        {roleLabel ? <span className="user-menu-role">{roleLabel}</span> : null}
        <span className="nav-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="menu-panel user-menu-panel" id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate("change-password");
            }}
          >
            Change Password
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
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
