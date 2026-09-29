import { useEffect, useState } from "react";
import { getNavMenus } from "../utils/accessControl";
import { SidebarIcon, ICON_MAP } from "./SidebarIcons";

const OPEN_KEY = "dpcell.sidebar.open";

function readOpen() {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/* Cursor/VS Code explorer-style collapsible section: chevron + title
   toggles the list; the section holding the active page auto-opens. */
function Group({ title, items, onNavigate, collapsed, page, icon }) {
  const hasActive = !!items?.some((item) => item.id === page);
  const [open, setOpen] = useState(() => {
    const saved = readOpen()[title];
    return saved === undefined ? true : saved;
  });

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  if (!items || items.length === 0) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [title]: next }));
    } catch {
      /* storage unavailable: state stays in memory only */
    }
  };

  const showItems = collapsed || open;
  return (
    <div className="side-group">
      {!collapsed && (
        <button
          type="button"
          className="side-title side-title-btn"
          aria-expanded={open}
          onClick={toggle}
        >
          <span className={`side-chevron ${open ? "is-open" : ""}`} aria-hidden="true">
            ›
          </span>
          <span className="side-title-icon" aria-hidden="true">{icon}</span>
          {title}
        </button>
      )}
      {showItems &&
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`side-link ${collapsed ? "" : "side-link-nested"}`}
            data-active={page === item.id ? "true" : undefined}
            title={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <SidebarIcon
              name={ICON_MAP[item.id]}
              className="side-icon"
            />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
    </div>
  );
}

export default function Sidebar({
  user,
  page,
  collapsed,
  mobileOpen,
  onNavigate,
  onToggle,
  onClose,
}) {
  const menus = getNavMenus(user);

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside
        className={`app-sidebar ${collapsed ? "is-collapsed" : ""} ${
          mobileOpen ? "is-open" : ""
        }`}
      >
        <button
          type="button"
          className="sidebar-brand"
          aria-label="Go to Home"
          title="Go to Home"
          onClick={() => onNavigate("home")}
        >
          <img src="/dp-logo.png" alt="" />
          {!collapsed && (
            <span>
              DP CELL
              <br />
              <small>Salary Management</small>
            </span>
          )}
        </button>
        <button type="button" className="side-toggle" onClick={onToggle}>
          {collapsed ? "»" : "« Collapse"}
        </button>
        {menus.showHome ? (
          <Group
            title="DASHBOARD"
            items={[{ id: "home", label: "Dashboard" }]}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="⌂"
          />
        ) : null}
        {menus.showMasters ? (
          <Group
            title="MASTERS"
            items={menus.masters}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="▦"
          />
        ) : null}
        {menus.showSalary ? (
          <Group
            title="SALARY"
            items={menus.salary}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="▤"
          />
        ) : null}
        {menus.showDaDifference ? (
          <Group
            title="DA DIFFERENCE"
            items={menus.daDifference}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="↔"
          />
        ) : null}
        {menus.showReports ? (
          <Group
            title="REPORTS"
            items={menus.reports}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="▥"
          />
        ) : null}
        {menus.showAdministration ? (
          <Group
            title="ADMINISTRATION"
            items={menus.administration}
            onNavigate={onNavigate}
            collapsed={collapsed}
            page={page}
            icon="⚙"
          />
        ) : null}
      </aside>
    </>
  );
}
