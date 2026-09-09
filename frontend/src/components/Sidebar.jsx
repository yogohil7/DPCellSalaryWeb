import { getNavMenus } from "../utils/accessControl";

function Group({ title, items, onNavigate, collapsed, page, icon }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="side-group">
      {!collapsed && (
        <div className="side-title">
          <span className="side-title-icon" aria-hidden="true">{icon}</span>
          {title}
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="side-link"
          data-active={page === item.id ? "true" : undefined}
          title={item.label}
          onClick={() => onNavigate(item.id)}
        >
          <span className="side-dot" />
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
        <div className="sidebar-brand">
          <img src="/dp-logo.png" alt="DP Cell" />
          {!collapsed && (
            <span>
              DP CELL
              <br />
              <small>Salary Management</small>
            </span>
          )}
        </div>
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
