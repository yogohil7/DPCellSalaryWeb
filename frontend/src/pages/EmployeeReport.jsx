import { useEffect, useMemo, useState } from "react";
import {
  getEmployeeReport,
  getEmployeeReportMeta,
  downloadEmployeeReportExcel,
} from "../utils/employeeReportApi";
import { GridToolbar } from "../components/DataGrid";
import "./employeeReport.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/*
  EMPLOYEE REPORT — administrative / HR, not a salary report.

  ONE page with four selections, not four pages. Choosing the Selection Type
  swaps the criterion control between a From/To date range and a single
  Increment Month; everything else — Section, Institute, the table, the
  exports — is shared.

  The columns are NOT hard-coded here. The backend's single report builder
  returns the column set for the chosen selection, so the screen, the Excel
  export, the PDF and Print can never show different columns or different
  rows. Nothing is computed on this page.
*/

const SELECTION_TYPES = [
  { value: "RETIREMENT_DATE", label: "Retirement Date Wise", mode: "DATE_RANGE" },
  { value: "CCC_PASS_DATE", label: "CCC Pass Date Wise", mode: "DATE_RANGE" },
  { value: "JOINING_DATE", label: "Joining Date Wise", mode: "DATE_RANGE" },
  { value: "INCREMENT_MONTH", label: "Increment Month Wise", mode: "MONTH" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function modeOf(selectionType) {
  const found = SELECTION_TYPES.find((t) => t.value === selectionType);
  return found ? found.mode : "DATE_RANGE";
}

export default function EmployeeReport({ user, onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("employeeReport");
  const [sections, setSections] = useState([]);
  const [institutes, setInstitutes] = useState([]);

  const [selectionType, setSelectionType] = useState("RETIREMENT_DATE");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [incrementMonth, setIncrementMonth] = useState(
    String(new Date().getMonth() + 1)
  );
  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  const mode = modeOf(selectionType);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getEmployeeReportMeta();
        if (cancelled) return;
        setSections(res?.data?.sections || []);
        setInstitutes(res?.data?.institutes || []);
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message || "Could not load the filter options.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Institutes narrow with the chosen Section, using the master data the
     meta endpoint already returned — no second lookup, no local copy. */
  const visibleInstitutes = useMemo(() => {
    if (!sectionId) return institutes;
    const wanted = Number(sectionId);
    return institutes.filter(
      (i) => !i.instituteCode || Number(i.sectionId) === wanted
    );
  }, [institutes, sectionId]);

  const filters = useMemo(
    () => ({
      selectionType,
      fromDate: mode === "DATE_RANGE" ? fromDate : "",
      toDate: mode === "DATE_RANGE" ? toDate : "",
      incrementMonth: mode === "MONTH" ? incrementMonth : "",
      sectionId,
      instituteCode,
    }),
    [selectionType, mode, fromDate, toDate, incrementMonth, sectionId, instituteCode]
  );

  async function handleShow(event) {
    if (event) event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await getEmployeeReport(filters);
      setReport(res?.data || null);
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadEmployeeReportExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handlePrint() {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    requestAnimationFrame(() => {
      printReport("employeeReport");
    });
  }

  const columns = report?.columns || [];
  const rows = report?.rows || [];

  const criteriaText = report
    ? report.selectionMode === "MONTH"
      ? `Increment Month: ${report.filters.incrementMonthName || "-"}`
      : `From: ${report.filters.fromDateText || "-"}     To: ${
          report.filters.toDateText || "-"
        }`
    : "";

  const summary = report
    ? [
        `Selection: ${report.selectionLabel}`,
        criteriaText,
        sectionId
          ? `Section: ${
              sections.find((s) => String(s.sectionId) === String(sectionId))
                ?.sectionName || sectionId
            }`
          : "Section: ALL",
        instituteCode ? `Institute: ${instituteCode}` : "Institute: ALL",
      ].join("     ")
    : "";

  return (
    <div className="emprep-page">
      <div className="emprep-toolbar no-print">
        <button type="button" className="emprep-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="emprep-filters no-print" onSubmit={handleShow}>
        <div className="emprep-field">
          <label htmlFor="emprep-selection">Selection Type</label>
          <select
            id="emprep-selection"
            value={selectionType}
            onChange={(e) => {
              setSelectionType(e.target.value);
              setReport(null);
            }}
          >
            {SELECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {mode === "DATE_RANGE" ? (
          <>
            <div className="emprep-field">
              <label htmlFor="emprep-from">From Date</label>
              <input
                id="emprep-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="emprep-field">
              <label htmlFor="emprep-to">To Date</label>
              <input
                id="emprep-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="emprep-field">
            <label htmlFor="emprep-month">Increment Month</label>
            <select
              id="emprep-month"
              value={incrementMonth}
              onChange={(e) => setIncrementMonth(e.target.value)}
            >
              {MONTHS.map((name, i) => (
                <option key={name} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="emprep-field">
          <label htmlFor="emprep-section">Section</label>
          <select
            id="emprep-section"
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setInstituteCode("");
            }}
          >
            <option value="">All Sections</option>
            {sections
              .filter((s) => s.sectionId != null)
              .map((s) => (
                <option key={s.sectionId} value={String(s.sectionId)}>
                  {s.sectionName}
                </option>
              ))}
          </select>
        </div>

        <div className="emprep-field">
          <label htmlFor="emprep-institute">Institute</label>
          <select
            id="emprep-institute"
            value={instituteCode}
            onChange={(e) => setInstituteCode(e.target.value)}
          >
            <option value="">All Institutes</option>
            {visibleInstitutes
              .filter((i) => i.instituteCode)
              .map((i) => (
                <option key={i.instituteCode} value={i.instituteCode}>
                  {i.instituteCode} — {i.instituteName}
                </option>
              ))}
          </select>
        </div>

        <button type="submit" className="emprep-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="emprep-message no-print">{message}</div> : null}

      {report ? (
        <div className="emprep-sheet">
          <div className="emprep-head">
            <div className="emprep-head-line emprep-title">{report.heading}</div>
            <div className="emprep-head-line">{report.subHeading}</div>
          </div>
          <div className="emprep-filter-summary">{summary}</div>
          <div className="emprep-scope-note">{report.selectionLabel}</div>

          {rows.length === 0 ? (
            <div className="emprep-empty">{report.emptyMessage}</div>
          ) : (
            <>
              <div className="emprep-table-wrap">
                <table className="emprep-table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          className={column.type === "number" ? "emprep-amt" : undefined}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.employeeId}-${row.srNo}`}>
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={
                              column.type === "number"
                                ? "emprep-amt"
                                : column.key === "employeeName" ||
                                  column.key === "instituteName"
                                ? "emprep-name"
                                : undefined
                            }
                          >
                            {row[column.key] == null || row[column.key] === ""
                              ? "—"
                              : String(row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="emprep-summary">
                <div className="emprep-summary-item">
                  <span>Employee Count</span>
                  {report.count}
                </div>
              </div>
            </>
          )}

          <div className="emprep-actions no-print">
            <GridToolbar
              reportName="employeeReport"
              subtitle={[summary]}
              title="Employee Report"
              columns={columns}
              rows={rows}
              showSearch={true}
              hiddenActions={["excel", "print"]}
            />
            <button
              type="button"
              className="emprep-btn"
              onClick={handleExcel}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export Excel"}
            </button>
            <button
              type="button"
              className="emprep-btn emprep-btn-ghost"
              onClick={handlePrint}
            >
              PDF
            </button>
            <button
              type="button"
              className="emprep-btn emprep-btn-ghost"
              onClick={handlePrint}
            >
              Print
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
