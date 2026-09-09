import { useMemo, useState } from "react";
import "../grid.css";

function statusClass(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `data-grid-status is-${key}`;
}

function cellText(column, row, index) {
  if (column.type === "serial") return String(index + 1);
  if (column.getValue) return column.getValue(row, index);
  const value = row?.[column.key];
  if (value == null) return "";
  return String(value);
}

function exportRows(columns, rows) {
  const cols = columns.filter((column) => column.exportable !== false && column.type !== "actions");
  const header = cols.map((column) => column.label);
  const body = rows.map((row, index) =>
    cols.map((column) => cellText(column, row, index).replace(/\s+/g, " ").trim())
  );
  return { header, body, cols };
}

function toCsv(header, body) {
  const esc = (value) => `"${String(value).replace(/"/g, '""')}"`;
  return [header, ...body].map((row) => row.map(esc).join(",")).join("\r\n");
}

function download(filename, text, mime) {
  const blob = new Blob(["\uFEFF" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printGrid(title, header, body) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!win) return;
  const rowsHtml = body
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${String(cell).replace(/</g, "&lt;")}</td>`).join("")}</tr>`
    )
    .join("");
  win.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1f2937; }
      h1 { font-size: 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d5dde5; padding: 6px 8px; }
      th { background: #2f4e6f; color: #fff; }
    </style></head><body>
    <h1>${title}</h1>
    <table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export function GridStatus({ value }) {
  return <span className={statusClass(value)}>{value || "-"}</span>;
}

export function GridActions({ onEdit, onDelete, extra }) {
  return (
    <div className="data-grid-actions">
      {onEdit ? (
        <button type="button" className="dg-btn dg-btn-primary" onClick={onEdit}>
          Edit
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="dg-btn dg-btn-danger" onClick={onDelete}>
          Delete
        </button>
      ) : null}
      {extra}
    </div>
  );
}

export function GridToolbar({
  title = "Records",
  columns,
  rows,
  visibleKeys,
  onToggleColumn,
  search,
  onSearchChange,
  showSearch = true,
  /*
    Optional opt-out for individual export buttons, e.g.
    hiddenActions={["excel", "print"]} when a page supplies its own.
    Defaults to showing everything, so no existing caller changes.
  */
  hiddenActions = [],
}) {
  const hidden = new Set(
    (Array.isArray(hiddenActions) ? hiddenActions : []).map((a) =>
      String(a).toLowerCase()
    )
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [localVisible, setLocalVisible] = useState({});
  const hideable = columns.filter((column) => column.hideable !== false && column.type !== "serial");
  const keys = onToggleColumn ? visibleKeys || {} : localVisible;
  const toggle = (key) => {
    if (onToggleColumn) {
      onToggleColumn(key);
      return;
    }
    setLocalVisible((prev) => ({ ...prev, [key]: prev[key] === false }));
  };

  const runExport = (mode) => {
    const visible = columns.filter((column) => {
      if (column.type === "serial") return true;
      if (column.key && keys[column.key] === false) return false;
      return true;
    });
    const { header, body } = exportRows(visible, rows);
    if (mode === "copy") {
      const text = [header, ...body].map((row) => row.join("\t")).join("\r\n");
      navigator.clipboard?.writeText(text);
      return;
    }
    if (mode === "csv") {
      download(`${title}.csv`, toCsv(header, body), "text/csv;charset=utf-8");
      return;
    }
    if (mode === "excel") {
      download(`${title}.xls`, toCsv(header, body), "application/vnd.ms-excel");
      return;
    }
    printGrid(title, header, body);
  };

  return (
    <div className="data-grid-toolbar no-print">
      <div className="data-grid-toolbar-left">
        <div className="data-grid-columns-menu">
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Column Visibility
          </button>
          {menuOpen ? (
            <div className="data-grid-columns-panel">
              {hideable.map((column) => (
                <label key={column.key || column.label}>
                  <input
                    type="checkbox"
                    checked={keys[column.key] !== false}
                    onChange={() => toggle(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        {hidden.has("copy") ? null : (
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => runExport("copy")}
          >
            Copy
          </button>
        )}
        {hidden.has("csv") ? null : (
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => runExport("csv")}
          >
            CSV
          </button>
        )}
        {hidden.has("excel") ? null : (
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => runExport("excel")}
          >
            Excel
          </button>
        )}
        {hidden.has("pdf") ? null : (
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => runExport("pdf")}
          >
            PDF
          </button>
        )}
        {hidden.has("print") ? null : (
          <button
            type="button"
            className="data-grid-tool-btn"
            onClick={() => runExport("print")}
          >
            Print
          </button>
        )}
      </div>
      {showSearch ? (
        <div className="data-grid-toolbar-right">
          <label className="data-grid-search">
            <span>Search:</span>
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder="Search"
              aria-label="Search grid"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export default function DataGrid({
  title = "Records",
  columns,
  rows,
  rowKey = "id",
  emptyText = "No records found.",
  pageSizes = [10, 25, 50, 100],
  defaultPageSize = 10,
  enablePagination = true,
  enableSort = true,
  selectedKey,
  onRowClick,
  footerTotals,
  headerGroups,
  stickyLeft = 0,
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [visibleKeys, setVisibleKeys] = useState(() => {
    const next = {};
    columns.forEach((column) => {
      if (column.key) next[column.key] = column.hidden ? false : true;
    });
    return next;
  });

  const visibleColumns = columns.filter((column) => {
    if (!column.key || column.type === "serial") return true;
    return visibleKeys[column.key] !== false;
  });

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row, index) =>
      visibleColumns.some((column) =>
        cellText(column, row, index).toLowerCase().includes(q)
      )
    );
  }, [rows, search, visibleColumns]);

  const sorted = useMemo(() => {
    if (!sortKey) return searched;
    const column = columns.find((item) => item.key === sortKey);
    if (!column || column.sortable === false || column.type === "actions") return searched;
    const copy = [...searched];
    copy.sort((a, b) => {
      const av = cellText(column, a, 0);
      const bv = cellText(column, b, 0);
      const an = Number(String(av).replace(/[,₹\s]/g, ""));
      const bn = Number(String(bv).replace(/[,₹\s]/g, ""));
      if (Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "") {
        return sortDir === "asc" ? an - bn : bn - an;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [searched, sortKey, sortDir, columns]);

  const total = sorted.length;
  const usePager = enablePagination && total > 10;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = usePager
    ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sorted;
  const start = total === 0 ? 0 : usePager ? (safePage - 1) * pageSize + 1 : 1;
  const end = usePager ? Math.min(safePage * pageSize, total) : total;

  const toggleSort = (column) => {
    if (!enableSort || column.sortable === false || column.type === "actions" || column.type === "serial") {
      return;
    }
    if (sortKey === column.key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  };

  const toggleColumn = (key) => {
    setVisibleKeys((prev) => ({ ...prev, [key]: prev[key] === false }));
  };

  const getRowId = (row, index) =>
    typeof rowKey === "function" ? rowKey(row, index) : row?.[rowKey] ?? index;

  const groupCells = () => {
    if (!headerGroups) return null;
    const cells = [];
    headerGroups.forEach((group) => {
      const span = visibleColumns.filter((column) => group.keys.includes(column.key) || (group.includeSerial && column.type === "serial")).length;
      if (span > 0) {
        cells.push(
          <th key={group.label} colSpan={span} className={group.className || ""}>
            {group.label}
          </th>
        );
      }
    });
    return cells;
  };

  return (
    <div className="data-grid-shell">
      <GridToolbar
        title={title}
        columns={columns}
        rows={sorted}
        visibleKeys={visibleKeys}
        onToggleColumn={toggleColumn}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />

      <div className="data-grid-container">
        <table className="data-grid">
          <thead>
            {headerGroups ? <tr className="dg-group">{groupCells()}</tr> : null}
            <tr>
              {visibleColumns.map((column, colIndex) => (
                <th
                  key={column.key || column.label}
                  style={{
                    ...(column.width
                      ? { minWidth: column.width, width: column.width }
                      : { minWidth: column.minWidth || 110 }),
                    ...(stickyLeft && colIndex < stickyLeft
                      ? {
                          left: visibleColumns
                            .slice(0, colIndex)
                            .reduce(
                              (sum, col) =>
                                sum +
                                Number(
                                  String(col.width || col.minWidth || 110).replace(
                                    "px",
                                    ""
                                  )
                                ),
                              0
                            ),
                        }
                      : null),
                  }}
                  onClick={() => toggleSort(column)}
                  className={[
                    column.type === "serial" ? "dg-serial" : "",
                    column.align === "left"
                      ? "dg-left"
                      : column.align === "right"
                        ? "dg-right"
                        : "dg-center",
                    stickyLeft && colIndex < stickyLeft ? "dg-sticky" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {column.label}
                  {sortKey === column.key ? (
                    <span className="dg-sort">{sortDir === "asc" ? "↑" : "↓"}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td className="data-grid-empty" colSpan={Math.max(visibleColumns.length, 1)}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => {
                const id = getRowId(row, index);
                const serial = start + index;
                return (
                  <tr
                    key={id}
                    className={selectedKey === id ? "is-selected" : ""}
                    onClick={() => onRowClick?.(row)}
                  >
                    {visibleColumns.map((column, colIndex) => {
                      const align =
                        column.align ||
                        (column.type === "number" ? "right" : column.type === "serial" || column.type === "status" || column.type === "date" ? "center" : "left");
                      return (
                        <td
                          key={column.key || column.label}
                          className={[
                            align === "right" ? "dg-right" : align === "center" ? "dg-center" : "dg-left",
                            column.type === "serial" ? "dg-serial" : "",
                            stickyLeft && colIndex < stickyLeft ? "dg-sticky" : "",
                            column.className || "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={
                            stickyLeft && colIndex < stickyLeft
                              ? {
                                  left: visibleColumns
                                    .slice(0, colIndex)
                                    .reduce(
                                      (sum, col) =>
                                        sum +
                                        Number(
                                          String(
                                            col.width || col.minWidth || 110
                                          ).replace("px", "")
                                        ),
                                      0
                                    ),
                                  minWidth: column.width || column.minWidth || 110,
                                  width: column.width || column.minWidth || 110,
                                }
                              : column.width
                                ? { minWidth: column.width, width: column.width }
                                : undefined
                          }
                        >
                          {column.type === "serial"
                            ? serial
                            : column.type === "status"
                              ? <GridStatus value={cellText(column, row, index)} />
                              : column.render
                                ? column.render(row, serial - 1)
                                : cellText(column, row, serial - 1)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {footerTotals ? (
            <tfoot>
              <tr>
                {visibleColumns.map((column, index) => (
                  <td
                    key={column.key || column.label}
                    className={column.type === "number" || footerTotals[column.key] != null ? "dg-right" : "dg-center"}
                  >
                    {index === 0
                      ? "Total"
                      : footerTotals[column.key] != null
                        ? footerTotals[column.key]
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="data-grid-footer no-print">
        <div className="data-grid-page-size">
          {usePager ? (
            <>
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span>entries</span>
            </>
          ) : (
            <span>
              Total records: {total}
            </span>
          )}
        </div>
        {usePager ? (
          <div className="data-grid-pager">
            <span>
              Showing {start} to {end} of {total}
            </span>
            <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .slice(Math.max(0, safePage - 3), safePage + 2)
              .map((num) => (
                <button
                  key={num}
                  type="button"
                  className={num === safePage ? "is-active" : ""}
                  onClick={() => setPage(num)}
                >
                  {num}
                </button>
              ))}
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
