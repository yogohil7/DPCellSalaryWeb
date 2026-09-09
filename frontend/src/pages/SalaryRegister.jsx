import { useEffect, useMemo, useState } from "react";
import {
  getSalaryRegisterMeta,
  getSalaryRegister,
  downloadSalaryRegisterExcel,
} from "../utils/salaryRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./salaryRegister.css";

/* Same amount formatting the other reports use. A null amount is a field the
   record genuinely does not have — an em dash, never a fabricated 0.00. */
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

/* The printed columns, in order. No Return Amount: no such field exists. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "instituteCode", label: "Institute Code" },
  { key: "instituteName", label: "Institute Name" },
  { key: "sectionName", label: "Section" },
  { key: "billCode", label: "Bill Code" },
  { key: "billMonth", label: "Bill Month" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "billNo", label: "Bill No." },
  { key: "billDate", label: "Bill Date" },
  { key: "salaryType", label: "Salary Type" },
  { key: "employees", label: "Employees" },
  { key: "grossAmount", label: "Gross Amount" },
  { key: "totalDeduction", label: "Total Deduction" },
  { key: "netSalary", label: "Net Salary" },
  { key: "chequeAmount", label: "Cheque Amount" },
  { key: "approvedBy", label: "Approved By" },
  { key: "approvedDate", label: "Approved Date" },
  { key: "status", label: "Status" },
];

const AMOUNT_KEYS = new Set([
  "grossAmount", "totalDeduction", "netSalary", "chequeAmount",
]);

export default function SalaryRegister({ user, onBack }) {
  const now = new Date();
  const [meta, setMeta] = useState({
    years: [], sections: [], institutes: [], salaryTypes: [],
  });
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
    getSalaryRegisterMeta()
      .then((res) => {
        if (!active) return;
        setMeta(
          res?.data || { years: [], sections: [], institutes: [], salaryTypes: [] }
        );
      })
      .catch(() => {
        if (active) {
          setMeta({ years: [], sections: [], institutes: [], salaryTypes: [] });
        }
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

  /* Screen, CSV, PDF and Copy all read this one array, already in the
     server's final order with its Sr. No., plus the same TOTAL line the table
     foot prints. Nothing is re-sorted or re-numbered here. */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => {
      const out = { ...row };
      AMOUNT_KEYS.forEach((key) => {
        out[key] = money(row[key]);
      });
      return out;
    });
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        srNo: "",
        instituteCode: "",
        instituteName: "TOTAL",
        sectionName: "", billCode: "", billMonth: "", salaryMonth: "",
        billNo: "", billDate: "", salaryType: "",
        employees: report.totals.employees,
        grossAmount: money(report.totals.grossAmount),
        totalDeduction: money(report.totals.totalDeduction),
        netSalary: money(report.totals.netSalary),
        chequeAmount: money(report.totals.chequeAmount),
        approvedBy: "", approvedDate: "", status: "",
      },
    ];
  }, [rows, report]);

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getSalaryRegister(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage(
          "No approved or locked salary bills found for the selected filters."
        );
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Salary Register.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadSalaryRegisterExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const summary = report
    ? [
        `Salary Month: ${report.periodLabel}`,
        billMonth ? `Bill Month: ${MONTHS[Number(billMonth) - 1]}` : null,
        `Salary Type: ${report.filters.salaryType}`,
        instituteCode ? `Institute: ${instituteCode}` : "Institute: ALL",
      ]
        .filter(Boolean)
        .join("     ")
    : "";

  return (
    <div className="sr-page">
      <div className="sr-toolbar no-print">
        <button type="button" className="sr-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="sr-filters no-print" onSubmit={handleShow}>
        <div className="sr-field">
          <label>Salary Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="sr-field">
          <label>Year</label>
          {meta.years?.length ? (
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {meta.years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          )}
        </div>

        <div className="sr-field">
          <label>Bill Month</label>
          <select
            value={billMonth}
            onChange={(e) => setBillMonth(e.target.value)}
          >
            <option value="">All Bill Months</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="sr-field">
          <label>Section</label>
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">All Sections</option>
            {(meta.sections || []).map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.sectionName}
              </option>
            ))}
          </select>
        </div>

        <div className="sr-field">
          <label>Institute</label>
          <select
            value={instituteCode}
            onChange={(e) => setInstituteCode(e.target.value)}
          >
            <option value="">All Institutes</option>
            {(meta.institutes || []).map((i) => (
              <option key={i.instituteCode} value={i.instituteCode}>
                {i.instituteCode} — {i.instituteName}
              </option>
            ))}
          </select>
        </div>

        <div className="sr-field">
          <label>Salary Type</label>
          <select
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            {(meta.salaryTypes?.length
              ? meta.salaryTypes
              : [
                  { value: "ALL", label: "All" },
                  { value: "REGULAR", label: "Regular Salary (incl. Old)" },
                  { value: "OLD", label: "Old Salary" },
                  { value: "DA_DIFFERENCE", label: "DA Difference" },
                ]
            ).map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="sr-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="sr-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="sr-sheet">
          <div className="sr-head">
            {report.heading.map((line, index) => (
              <div
                key={line}
                className={`sr-head-line${index === 0 ? " sr-title" : ""}`}
              >
                {line}
              </div>
            ))}
          </div>

          <div className="sr-filter-summary">{summary}</div>

          <div className="sr-table-wrap">
            <table className="sr-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={
                        AMOUNT_KEYS.has(column.key) || column.key === "employees"
                          ? "sr-amt"
                          : ""
                      }
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.billCodeId}-${row.instituteCode}-${row.salaryType}`}>
                    {COLUMNS.map((column) => {
                      if (AMOUNT_KEYS.has(column.key)) {
                        return (
                          <td key={column.key} className="sr-amt">
                            {money(row[column.key])}
                          </td>
                        );
                      }
                      if (column.key === "employees") {
                        return (
                          <td key={column.key} className="sr-amt">
                            {row.employees}
                          </td>
                        );
                      }
                      if (column.key === "instituteName") {
                        return (
                          <td key={column.key} className="sr-name">
                            {row.instituteName}
                          </td>
                        );
                      }
                      if (column.key === "salaryType") {
                        return (
                          <td key={column.key} className="sr-type">
                            {row.salaryType === "DA_DIFFERENCE"
                              ? "DA DIFFERENCE"
                              : row.salaryType}
                          </td>
                        );
                      }
                      return <td key={column.key}>{row[column.key]}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td />
                  <td className="sr-name">TOTAL</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="sr-amt">{report.totals.employees}</td>
                  <td className="sr-amt">{money(report.totals.grossAmount)}</td>
                  <td className="sr-amt">{money(report.totals.totalDeduction)}</td>
                  <td className="sr-amt">{money(report.totals.netSalary)}</td>
                  <td className="sr-amt">{money(report.totals.chequeAmount)}</td>
                  <td />
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="sr-actions no-print">
            <GridToolbar
              title="Salary Register"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <button
              type="button"
              className="sr-btn"
              onClick={handleExcel}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Excel"}
            </button>
            <button type="button" className="sr-btn sr-btn-ghost" onClick={handlePrint}>
              Print / PDF
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
