import { useEffect, useMemo, useRef, useState } from "react";
import { getNavMenus } from "../utils/accessControl";
import { SidebarIcon, ICON_MAP } from "./SidebarIcons";
import "./commandPalette.css";

/*
  Navigation command palette (Ctrl/Cmd + K).

  It searches ONLY the existing navigation definitions: getNavMenus(user)
  already returns the permission-filtered Masters / Salary / DA Difference /
  Reports / Administration lists built from modules.js, so no route or
  permission is duplicated here and a user can never see a page they may
  not open.

  EXTENSION POINT: to add global employee / bill search later, append more
  entries to the array built in `entries` below (same { id, label, group }
  shape, or add a `run()` for non-navigation actions). No such search API
  exists today, so nothing is faked.
*/
function buildEntries(user) {
  const menus = getNavMenus(user);
  const entries = [];
  const add = (group, list) =>
    (list || []).forEach((item) =>
      entries.push({ id: item.id, label: item.label, group })
    );

  if (menus.showHome) entries.push({ id: "home", label: "Dashboard", group: "Home" });
  if (menus.salaryApprovalDirect)
    entries.push({ id: "salary-approval", label: "Salary Approval", group: "Salary" });
  add("Masters", menus.masters);
  add("Salary", menus.salary);
  add("DA Difference", menus.daDifference);
  add("Reports", menus.reports);
  add("Administration", menus.administration);
  return entries;
}

export default function CommandPalette({ user, open, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const entries = useMemo(() => buildEntries(user), [user]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    const terms = q.split(/\s+/);
    return entries.filter((entry) => {
      const hay = `${entry.label} ${entry.group}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [entries, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  if (!open) return null;

  const choose = (entry) => {
    if (!entry) return;
    onClose();
    onNavigate(entry.id);
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search menus"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-search">
          <SidebarIcon name="search" className="cmdk-search-icon" size={18} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search menus and pages…"
            aria-label="Search menus and pages"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[active] ? `cmdk-item-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmdk-empty">No matching pages</div>
          ) : (
            results.map((entry, index) => (
              <button
                key={`${entry.group}-${entry.id}`}
                id={`cmdk-item-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`cmdk-item ${index === active ? "is-active" : ""}`}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(entry)}
              >
                <SidebarIcon
                  name={ICON_MAP[entry.id]}
                  className="cmdk-item-icon"
                  size={16}
                />
                <span className="cmdk-item-label">{entry.label}</span>
                <span className="cmdk-item-group">{entry.group}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmdk-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
