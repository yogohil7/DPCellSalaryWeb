import { Fragment, useEffect, useId, useRef, useState } from "react";
import UserMenu from "./UserMenu";
import { getNavMenus } from "../utils/accessControl";
import { NavigationIcon, SidebarIcon, ICON_MAP } from "./SidebarIcons";

/* Top-level nav item id -> icon name (SidebarIcons.ICON_DEFS). Reuses the
   same icon set as the sidebar; see SidebarIcons.jsx for the mapping used
   there for individual pages. */
const TOP_NAV_ICONS = {
  home: "dashboard",
  masters: "layers",
  salary: "wallet",
  daDifference: "percent",
  reports: "fileText",
};

const HOVER_CLOSE_MS = 180;

function DropNav({
  label,
  navIcon,
  items,
  onNavigate,
  active,
  activePage,
  onOpenChange,
  openLabel,
  forceCloseToken,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const focusOnOpen = useRef(false);
  const closeTimer = useRef(null);
  const menuId = useId();

  const setOpenSafe = (next) => {
    setOpen(next);
    onOpenChange?.(label, next);
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

  /* Only one dropdown open at a time: when another menu becomes the open
     one, close this one (no callback, so it cannot clobber the new state). */
  useEffect(() => {
    if (openLabel !== label) setOpen(false);
  }, [openLabel, label]);

  useEffect(() => () => clearCloseTimer(), []);

  /* Keyboard open (ArrowDown) moves focus into the first item, like a
     desktop menu bar. Mouse open leaves focus alone. */
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      panelRef.current?.querySelector('[role="menuitem"]')?.focus();
    }
  }, [open]);

  const onPanelKeyDown = (event) => {
    const els = Array.from(
      panelRef.current?.querySelectorAll('[role="menuitem"]') || []
    );
    if (!els.length) return;
    const idx = els.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = els[(idx + 1) % els.length];
    else if (event.key === "ArrowUp")
      next = els[(idx - 1 + els.length) % els.length];
    else if (event.key === "Home") next = els[0];
    else if (event.key === "End") next = els[els.length - 1];
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpenSafe(false);
      if (event.key === "Escape") btnRef.current?.focus();
      return;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

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
        ref={btnRef}
        className={`nav-item ${active || open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpenSafe(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpenSafe(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusOnOpen.current = true;
            if (open) {
              focusOnOpen.current = false;
              panelRef.current?.querySelector('[role="menuitem"]')?.focus();
            } else setOpenSafe(true);
          }
        }}
      >
        <span className="nav-item-label">
          <NavigationIcon name={navIcon} className="nav-icon" />
          <span>{label}</span>
        </span>
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
          ref={panelRef}
          onMouseEnter={clearCloseTimer}
          onKeyDown={onPanelKeyDown}
        >
          {items.map((item, index) => {
            const isItemActive = activePage === item.id;
            return (
              <Fragment key={item.id}>
                {item.separatorBefore && index > 0 ? (
                  <div className="dropdown-separator" aria-hidden="true" />
                ) : null}
              <button
                type="button"
                role="menuitem"
                className={isItemActive ? "is-active" : ""}
                onClick={() => {
                  setOpenSafe(false);
                  onNavigate(item.id);
                }}
              >
                <SidebarIcon
                  name={ICON_MAP[item.id]}
                  className="menu-item-icon"
                  size={16}
                />
                <span className="menu-item-text">{item.label}</span>
                {isItemActive ? (
                  <span className="menu-item-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
              </Fragment>
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
  onOpenPalette,
}) {
  const menus = getNavMenus(user);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [forceCloseToken, setForceCloseToken] = useState(0);
  const [openLabel, setOpenLabel] = useState(null);
  const handleOpenChange = (label, next) =>
    setOpenLabel((prev) => (next ? label : prev === label ? null : prev));

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
          <span className="nav-item-label">
            <NavigationIcon name={TOP_NAV_ICONS.home} className="nav-icon" />
            Home
          </span>
        </button>
      ) : null}

      {menus.showMasters ? (
        <DropNav
          label="Masters"
          navIcon={TOP_NAV_ICONS.masters}
          items={menus.masters}
          onNavigate={navigateAndClose}
          active={masterIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
          openLabel={openLabel}
          onOpenChange={handleOpenChange}
        />
      ) : null}

      {menus.salaryApprovalDirect ? (
        <button
          type="button"
          className={`nav-item ${page === "salary-approval" ? "is-active" : ""}`}
          onClick={() => navigateAndClose("salary-approval")}
        >
          <span className="nav-item-label">
            <NavigationIcon name={TOP_NAV_ICONS.salary} className="nav-icon" />
            Salary Approval
          </span>
        </button>
      ) : null}

      {menus.showSalary ? (
        <DropNav
          label="Salary"
          navIcon={TOP_NAV_ICONS.salary}
          items={menus.salary}
          onNavigate={navigateAndClose}
          active={salaryIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
          openLabel={openLabel}
          onOpenChange={handleOpenChange}
        />
      ) : null}

      {menus.showDaDifference ? (
        <DropNav
          label="DA Difference"
          navIcon={TOP_NAV_ICONS.daDifference}
          items={menus.daDifference}
          onNavigate={navigateAndClose}
          active={daIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
          openLabel={openLabel}
          onOpenChange={handleOpenChange}
        />
      ) : null}

      {menus.showReports ? (
        <DropNav
          label="Reports"
          navIcon={TOP_NAV_ICONS.reports}
          items={menus.reports}
          onNavigate={navigateAndClose}
          active={reportIds.includes(page)}
          activePage={page}
          forceCloseToken={forceCloseToken}
          openLabel={openLabel}
          onOpenChange={handleOpenChange}
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

      {onOpenPalette ? (
        <button
          type="button"
          className="palette-trigger"
          onClick={onOpenPalette}
          aria-label="Search menus (Ctrl+K)"
          title="Search menus (Ctrl+K)"
        >
          <NavigationIcon name="search" className="nav-icon" />
          <span className="palette-trigger-text">Search</span>
          <kbd className="palette-trigger-kbd">Ctrl K</kbd>
        </button>
      ) : null}

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
