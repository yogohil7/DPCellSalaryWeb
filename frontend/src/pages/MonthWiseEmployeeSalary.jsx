import { useEffect, useMemo, useState } from "react";
import {
  getMonthWiseEmployeeSalaryMeta,
  getMonthWiseEmployeeSalary,
  downloadMonthWiseEmployeeSalaryExcel,
} from "../utils/monthWiseEmployeeSalaryApi";
import { GridToolbar } from "../components/DataGrid";
import "./monthWiseEmployeeSalary.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/* Same amount formatting every other report uses. */
function money(value) {
  if (value == null) return "—";
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* The 25 required columns, in the exact required order — mirrors
   backend/routes/monthWiseEmployeeSalary.js's XLSX_COLUMNS exactly, so the
   screen, CSV/Copy export and Excel download can never disagree. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No" },
  { key: "instituteName", label: "Institute Name" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "basic", label: "Basic" },
  { key: "gradePay", label: "G.P." },
  { key: "totalBasic", label: "Total Basic" },
  { key: "da", label: "D.A." },
  { key: "hra", label: "H.R.A." },
  { key: "medical", label: "Medical" },
  { key: "ta", label: "T.A." },
  { key: "cla", label: "C.L.A." },
  { key: "specialAllowance", label: "Spl. Allowance" },
  { key: "washingAllowance", label: "Wash. Allowance" },
  { key: "total", label: "Total" },
  { key: "gpf", label: "GPF" },
  { key: "gpfAdvance", label: "GPF Adv." },
  { key: "nps", label: "NPS" },
  { key: "incomeTax", label: "Income Tax" },
  { key: "professionalTax", label: "Prof. Tax" },
  { key: "otherDeduction", label: "Other Ded." },
  { key: "totalDeduction", label: "Total Ded." },
  { key: "net", label: "Net" },
  { key: "chequeAmount", label: "Cheque Amt." },
];

const AMOUNT_KEYS = new Set([
  "basic", "gradePay", "totalBasic", "da", "hra", "medical", "ta", "cla",
  "specialAllowance", "washingAllowance", "total", "gpf", "gpfAdvance",
  "nps", "incomeTax", "professionalTax", "otherDeduction", "totalDeduction",
  "net", "chequeAmount",
]);

export default function MonthWiseEmployeeSalary({ user, onBack }) {
  /* A4 PORTRAIT for this report — utils/reportPdfConfig.js (25 columns fits
     the same scaled-portrait layout Employee Wise Salary already uses for
     27 columns; no new PDF library, no landscape default introduced). */
  useReportPrintPage("monthWiseEmployeeSalary");
  const now = new Date();
  const [meta, setMeta] = useState({ years: [], sections: [], institutes: [], salaryTypes: [] });
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [billMonth, setBillMonth] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [salaryType, setSalaryType] = useState("ALL");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getMonthWiseEmployeeSalaryMeta()
      .then((res) => {
        if (!active) return;
        setMeta(res?.data || { years: [], sections: [], institutes: [], salaryTypes: [] });
      })
      .catch(() => {
        if (active) setMeta({ years: [], sections: [], institutes: [], salaryTypes: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  const filters = {
    month,
    year,
    billMonth: billMonth || undefined,
    sectionId: sectionId || undefined,
    instituteCode: instituteCode || undefined,
    salaryType,
  };

  const rows = report?.rows || [];

  /* Screen, CSV, PDF, Copy and Print all read this one array, already in the
     server's final order with Institute Total rows and Sr. No. included.
     Nothing is re-sorted, re-grouped or re-numbered here. */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => {
      const out = { ...row };
      AMOUNT_KEYS.forEach((key) => {
        out[key] = money(row[key]);
      });
      if (row.type === "INSTITUTE_TOTAL") {
        out.employeeName = "INSTITUTE TOTAL";
        out.designation = "";
        out.srNo = "";
      }
      return out;
    });
    if (!report || mapped.length === 0) return mapped;
    const grand = { srNo: "", instituteName: "", instituteCode: "", employeeName: "GRAND TOTAL", designation: "" };
    AMOUNT_KEYS.forEach((key) => {
      grand[key] = money(report.grandTotal[key]);
    });
    return [...mapped, grand];
  }, [rows, report]);

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getMonthWiseEmployeeSalary(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage("No approved or locked salary records found for the selected filters.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Month-Wise Employee Salary Report.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setMonth(String(now.getMonth() + 1));
    setYear(String(now.getFullYear()));
    setBillMonth("");
    setSectionId("");
    setInstituteCode("");
    setSalaryType("ALL");
    setReport(null);
    setMessage("");
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadMonthWiseEmployeeSalaryExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    printReport("monthWiseEmployeeSalary");
  }

  const summary = report
    ? [
        `Salary Month: ${report.salaryMonthLabel}`,
        `Bill Month: ${report.billMonthLabel}`,
        `Section: ${report.sectionLabel}`,
        `Institute: ${report.instituteLabel}`,
        `Salary Type: ${report.salaryTypeLabel}`,
      ].join("     ")
    : "";

  return (
    <div className="mw-page">
      <div className="mw-toolbar no-print">
        <button type="button" className="mw-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="mw-filters no-print" onSubmit={handleShow}>
        <div className="mw-field">
          <label>Salary Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="mw-field">
          <label>Year</label>
          {meta.years?.length ? (
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {meta.years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          ) : (
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          )}
        </div>

        <div className="mw-field">
          <label>Bill Month</label>
          <select value={billMonth} onChange={(e) => setBillMonth(e.target.value)}>
            <option value="">All Bill Months</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="mw-field">
          <label>Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">All Sections</option>
            {(meta.sections || [])
              .filter((s) => s.sectionId != null)
              .map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.sectionName}
                </option>
              ))}
          </select>
        </div>

        <div className="mw-field">
          <label>Institute</label>
          <select value={instituteCode} onChange={(e) => setInstituteCode(e.target.value)}>
            <option value="">All Institutes</option>
            {(meta.institutes || []).map((i) => (
              <option key={i.instituteCode} value={i.instituteCode}>
                {i.instituteCode} — {i.instituteName}
              </option>
            ))}
          </select>
        </div>

        <div className="mw-field">
          <label>Salary Type</label>
          <select value={salaryType} onChange={(e) => setSalaryType(e.target.value)}>
            {(meta.salaryTypes?.length
              ? meta.salaryTypes
              : [
                  { value: "ALL", label: "All" },
                  { value: "REGULAR", label: "Regular" },
                  { value: "OLD", label: "Old" },
                ]
            ).map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="mw-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
        <button type="button" className="mw-btn mw-btn-ghost" onClick={handleReset} disabled={loading}>
          Reset
        </button>
      </form>

      {message ? <div className="mw-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="mw-sheet">
          <div className="mw-head">
            {report.heading.map((line, index) => (
              <div key={line} className={`mw-head-line${index === 0 ? " mw-title" : ""}`}>
                {line}
              </div>
            ))}
            <div className="mw-head-line mw-title">{report.title}</div>
          </div>

          <div className="mw-filter-summary">{summary}</div>

          <div className="mw-table-wrap">
            <table className="mw-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} className={AMOUNT_KEYS.has(column.key) ? "mw-amt" : ""}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) =>
                  row.type === "INSTITUTE_TOTAL" ? (
                    <tr
                      key={`total-${row.instituteCode}-${index}`}
                      className="mw-institute-total"
                    >
                      {COLUMNS.map((column) => {
                        if (column.key === "instituteCode") return <td key={column.key}>{row.instituteCode}</td>;
                        if (column.key === "instituteName") return <td key={column.key}>{row.instituteName}</td>;
                        if (column.key === "employeeName") {
                          return (
                            <td key={column.key} className="mw-name">
                              {row.label}
                            </td>
                          );
                        }
                        if (AMOUNT_KEYS.has(column.key)) {
                          return (
                            <td key={column.key} className="mw-amt">
                              {money(row[column.key])}
                            </td>
                          );
                        }
                        return <td key={column.key} />;
                      })}
                    </tr>
                  ) : (
                    <tr key={row.detailId != null ? row.detailId : `${row.instituteCode}-${row.employeeId}-${index}`}>
                      {COLUMNS.map((column) => {
                        if (AMOUNT_KEYS.has(column.key)) {
                          return (
                            <td key={column.key} className="mw-amt">
                              {money(row[column.key])}
                            </td>
                          );
                        }
                        if (column.key === "employeeName") {
                          return (
                            <td key={column.key} className="mw-name">
                              {row.employeeName}
                            </td>
                          );
                        }
                        return <td key={column.key}>{row[column.key]}</td>;
                      })}
                    </tr>
                  )
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td />
                  <td />
                  <td className="mw-name">GRAND TOTAL</td>
                  <td />
                  {COLUMNS.slice(5).map((column) => (
                    <td key={column.key} className={AMOUNT_KEYS.has(column.key) ? "mw-amt" : ""}>
                      {AMOUNT_KEYS.has(column.key) ? money(report.grandTotal[column.key]) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mw-actions no-print">
            <GridToolbar
              reportName="monthWiseEmployeeSalary"
              subtitle={[summary]}
              title="Month-Wise Employee Salary Report"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <button type="button" className="mw-btn" onClick={handleExcel} disabled={exporting}>
              {exporting ? "Exporting..." : "Excel"}
            </button>
            <button type="button" className="mw-btn mw-btn-ghost" onClick={handlePrint}>
              Print / PDF
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
