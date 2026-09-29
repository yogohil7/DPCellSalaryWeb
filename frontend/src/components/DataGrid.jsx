import { useMemo, useState } from "react";
import "../grid.css";
import { buildReportPrintHtml, formatIndianMoney, getReportPdfOptions } from "../utils/reportPdfConfig";

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

/*
 * PDF / Print for every report grid (2026-09-24).
 *
 * The old version opened a window with "noopener", which makes window.open
 * return null in current browsers, so both buttons silently did nothing.
 * This prints through a hidden iframe instead (no popup blocker), with the
 * report's own paper and orientation from reportPdfConfig.js (Legal landscape for Cheque
 * Register only, portrait for everything else), a header row that repeats
 * on every page, the heading / filter lines and the totals row.  The rows
 * are exactly what the screen grid exports — nothing is fetched again.
 */
function printGrid({ reportName, title, subtitle, header, body, footer }) {
  if (typeof document === "undefined") return;
  const options = getReportPdfOptions(reportName);
  const html = buildReportPrintHtml({
    reportName,
    title,
    subtitle,
    header,
    body,
    footer,
    printedOn: new Date().toLocaleString("en-IN"),
  });
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "print");
  /* Laid out at the printable page width so the fit-to-width check below is real. */
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${options.printableWidthPx}px;height:200px;border:0;`;
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();

  const previousTitle = document.title;
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    document.title = previousTitle;
    frame.remove();
  };

  window.setTimeout(() => {
    try {
      /*
        Shrink (never enlarge) the font until the table fits the page width,
        so no column is cut off.  The width is re-measured after every step,
        so the fit is checked rather than estimated.
      */
      const table = doc.querySelector("table");
      for (let pass = 0; table && pass < 4; pass += 1) {
        const needed = table.scrollWidth;
        if (needed <= options.printableWidthPx) break;
        const current = parseFloat(win.getComputedStyle(doc.body).fontSize) || 10;
        const next = Math.max(4, Math.floor(current * (options.printableWidthPx / needed) * 10) / 10);
        if (next >= current) break;
        doc.body.style.fontSize = `${next}px`;
      }
      /* Very wide grids (e.g. Variation Report) still too wide at the smallest
         font are scaled as a last resort, so nothing is ever clipped. */
      if (table && table.scrollWidth > options.printableWidthPx) {
        const zoom = Math.floor((options.printableWidthPx / table.scrollWidth) * 100) / 100;
        doc.body.style.zoom = String(Math.max(0.3, zoom));
      }
      document.title = doc.title || previousTitle;
      win.addEventListener("afterprint", () => window.setTimeout(cleanup, 0));
      win.focus();
      win.print();
    } finally {
      window.setTimeout(cleanup, 60000);
    }
  }, 60);
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
  /*
    PDF / Print layout (see utils/reportPdfConfig.js):
      reportName  key into REPORT_PDF_CONFIG (unknown -> A4 portrait)
      subtitle    heading / filter / period line(s) printed under the title
      footerRows  totals row(s), same objects/keys as `rows`, printed last
      moneyKeys   raw numeric keys printed in Indian format (PDF/Print only;
                  CSV / Copy keep the raw values they always had)
  */
  reportName = "",
  subtitle,
  footerRows = [],
  moneyKeys = [],
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
  /* Select All / Clear All reuse the per-column toggle for only the columns
     whose state differs, so column-visibility state handling is unchanged. */
  const setAllVisible = (visible) => {
    hideable.forEach((column) => {
      const isVisible = keys[column.key] !== false;
      if (isVisible !== visible) toggle(column.key);
    });
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
    const money = new Set(Array.isArray(moneyKeys) ? moneyKeys : []);
    const printCols = money.size
      ? visible.map((column) =>
          money.has(column.key) && !column.getValue
            ? {
                ...column,
                getValue: (row) =>
                  row?.[column.key] == null || row[column.key] === ""
                    ? ""
                    : formatIndianMoney(row[column.key]),
              }
            : column
        )
      : visible;
    const printed = exportRows(printCols, rows);
    const footer = exportRows(
      printCols.map((column) => (column.type === "serial" ? { ...column, type: undefined } : column)),
      Array.isArray(footerRows) ? footerRows : []
    ).body;
    printGrid({
      reportName,
      title,
      subtitle,
      header: printed.header,
      body: printed.body,
      footer,
    });
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
              <div className="data-grid-columns-actions">
                <button type="button" onClick={() => setAllVisible(true)}>
                  Select All
                </button>
                <button type="button" onClick={() => setAllVisible(false)}>
                  Clear All
                </button>
              </div>
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
