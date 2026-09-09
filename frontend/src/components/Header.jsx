import { useEffect, useId, useRef, useState } from "react";
import UserMenu from "./UserMenu";
import { getNavMenus } from "../utils/accessControl";

const HOVER_CLOSE_MS = 180;

function DropNav({
  label,
  items,
  onNavigate,
  active,
  activePage,
  onOpenChange,
  forceCloseToken,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const menuId = useId();

  const setOpenSafe = (next) => {
    setOpen(next);
    onOpenChange?.(next ? label : null);
  };

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpenSafe(false), HOVER_CLOSE_MS);
  };

  useEffect(() => {
    const close = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpenSafe(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [forceCloseToken]);

  useEffect(() => () => clearCloseTimer(), []);

  if (!items || items.length === 0) return null;

  return (
    <div
      className={`nav-dd ${open ? "is-open" : ""}`}
      ref={ref}
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          clearCloseTimer();
          setOpenSafe(true);
        }
      }}
      onMouseLeave={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          scheduleClose();
        }
      }}
    >
      <button
        type="button"
        className={`nav-item ${active || open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpenSafe(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpenSafe(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpenSafe(true);
          }
        }}
      >
        <span>{label}</span>
        <span className="nav-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="menu-panel"
          id={menuId}
          role="menu"
          aria-label={label}
          onMouseEnter={clearCloseTimer}
        >
          {items.map((item) => {
            const isItemActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={isItemActive ? "is-active" : ""}
                onClick={() => {
                  setOpenSafe(false);
                  onNavigate(item.id);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function Header({
  user,
  page,
  onNavigate,
  onLogout,
  showSidebarToggle,
  onToggleSidebar,
}) {
  const menus = getNavMenus(user);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [forceCloseToken, setForceCloseToken] = useState(0);

  const masterIds = menus.masters.map((i) => i.id);
  const salaryIds = menus.salary.map((i) => i.id);
  const daIds = (menus.daDifference || []).map((i) => i.id);
  const reportIds = menus.reports.map((i) => i.id);

  const navigateAndClose = (id) => {
    setMobileNavOpen(false);
    setForceCloseToken((n) => n + 1);
    onNavigate(id);
  };

  const navContent = (
    <>
      {menus.showHome ? (
        <button
          type="button"
          className={`nav-item ${page === "home" ? "is-active" : ""}`}
          onClick={() => navigateAndClose("home")}
        >
          Home
        </button>
      ) : null}

      {menus.showMasters ? (
        <DropNav
          label="Masters"
          items={menus.masters}
          onNavigate={navigateAndClose}
          active={masterIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
        />
      ) : null}

      {menus.salaryApprovalDirect ? (
        <button
          type="button"
          className={`nav-item ${page === "salary-approval" ? "is-active" : ""}`}
          onClick={() => navigateAndClose("salary-approval")}
        >
          Salary Approval
        </button>
      ) : null}

      {menus.showSalary ? (
        <DropNav
          label="Salary"
          items={menus.salary}
          onNavigate={navigateAndClose}
          active={salaryIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
        />
      ) : null}

      {menus.showDaDifference ? (
        <DropNav
          label="DA Difference"
          items={menus.daDifference}
          onNavigate={navigateAndClose}
          active={daIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
        />
      ) : null}

      {menus.showReports ? (
        <DropNav
          label="Reports"
          items={menus.reports}
          onNavigate={navigateAndClose}
          active={reportIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
        />
      ) : null}
    </>
  );

  return (
    <header className="app-header">
      <div className="header-left">
        {showSidebarToggle ? (
          <button
            type="button"
            className="hamburger sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}

        <button
          type="button"
          className="hamburger mobile-nav-toggle"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label="Toggle navigation menu"
          aria-expanded={mobileNavOpen}
        >
          <span />
          <span />
          <span />
        </button>

      </div>

      <nav className="header-nav desktop-nav" aria-label="Main">
        {navContent}
      </nav>

      <UserMenu user={user} onNavigate={navigateAndClose} onLogout={onLogout} />

      {mobileNavOpen ? (
        <>
          <div
            className="mobile-nav-backdrop"
            onClick={() => setMobileNavOpen(false)}
          />
          <nav className="mobile-nav-panel" aria-label="Mobile main">
            <div className="mobile-nav-title">Menu</div>
            {navContent}
          </nav>
        </>
      ) : null}
    </header>
  );
}
