import { useEffect, useMemo, useState } from "react";
import {
  getNpsGpfDeduction,
  downloadNpsGpfDeductionExcel,
} from "../utils/npsGpfDeductionApi";
import { getEmployeeWiseSalaryMeta } from "../utils/employeeWiseSalaryApi";
import { listInstitutes } from "../utils/instituteApi";
import { sortInstitutesByCode } from "../utils/instituteCodeSort";
import { listEmployees } from "../utils/employeeApi";
import { GridToolbar } from "../components/DataGrid";
import "./npsGpfDeduction.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/* Stored values, en-IN with paise. An exact zero prints as "0". */
function money(value) {
  const n = Number(value || 0);
  if (n === 0) return "0";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* Screen, Copy, CSV, Excel, PDF and Print all read these columns. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "employeeCode", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "sectionName", label: "Section" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "instituteName", label: "Institute Name" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "billMonth", label: "Bill Month" },
  { key: "billType", label: "Bill Type" },
  { key: "salaryCategoryShort", label: "Salary Type" },
  { key: "gpfDeduction", label: "GPF Deduction" },
  { key: "npsDeduction", label: "NPS Deduction" },
  { key: "totalDeduction", label: "Total Deduction" },
];

const MONEY_KEYS = ["gpfDeduction", "npsDeduction", "totalDeduction"];

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export default function NpsGpfDeduction({ onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("npsGpfDeduction");
  const [sections, setSections] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [years, setYears] = useState([]);

  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [allMonths, setAllMonths] = useState(false);
  const [fromMonth, setFromMonth] = useState(String(new Date().getMonth() + 1));
  const [fromYear, setFromYear] = useState(String(new Date().getFullYear()));
  const [toMonth, setToMonth] = useState(String(new Date().getMonth() + 1));
  const [toYear, setToYear] = useState(String(new Date().getFullYear()));
  const [salaryType, setSalaryType] = useState("ALL");
  const [deductionType, setDeductionType] = useState("ALL");
  const [salaryCategory, setSalaryCategory] = useState("ALL");

  const [report, setReport] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  /* Filters are loaded once; the report itself is one request per Show. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, instituteList, employeeList] = await Promise.all([
          getEmployeeWiseSalaryMeta(),
          listInstitutes(),
          listEmployees(),
        ]);
        if (cancelled) return;
        const metaData = meta?.data || {};
        setSections(
          (metaData.sections || []).filter((s) => s.sectionId != null)
        );
        const yearList = (metaData.years || []).map(String);
        setYears(
          yearList.length ? yearList : [String(new Date().getFullYear())]
        );
        const instituteRows = Array.isArray(instituteList)
          ? instituteList
          : instituteList?.data || [];
        setInstitutes(instituteRows);
        const employeeRows = Array.isArray(employeeList)
          ? employeeList
          : employeeList?.data || [];
        setEmployees(employeeRows);
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message || "Could not load the report filters.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Institute list follows the chosen section, without a second request.
     Natural InstituteCode presentation order (never InstituteId). */
  const visibleInstitutes = useMemo(() => {
    const list = !sectionId
      ? institutes
      : institutes.filter(
          (i) => String(i.sectionId ?? i.SectionId ?? "") === String(sectionId)
        );
    return sortInstitutesByCode(list);
  }, [institutes, sectionId]);

  const visibleEmployees = useMemo(() => {
    if (!sectionId && !instituteCode) return employees;
    return employees.filter((e) => {
      const code = String(e.instituteCode ?? e.InstituteCode ?? "");
      const sec = String(e.sectionId ?? e.SectionId ?? "");
      if (instituteCode && code !== instituteCode) return false;
      if (sectionId && sec && sec !== String(sectionId)) return false;
      return true;
    });
  }, [employees, sectionId, instituteCode]);

  const filters = useMemo(
    () => ({
      sectionId,
      instituteCode,
      employeeId,
      allMonths,
      fromMonth,
      fromYear,
      toMonth,
      toYear,
      salaryType,
      deductionType,
      salaryCategory,
    }),
    [
      sectionId, instituteCode, employeeId, allMonths,
      fromMonth, fromYear, toMonth, toYear, salaryType, deductionType,
      salaryCategory,
    ]
  );

  async function handleShow(event) {
    if (event) event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await getNpsGpfDeduction(filters);
      setReport(response?.data || null);
      if (!response?.data?.rows?.length) {
        setMessage("No GPF / NPS deduction records found for the selected criteria.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the NPS / GPF Deduction Report.");
    } finally {
      setLoading(false);
    }
  }

  /*
    Print and PDF share one flow: fonts first so Inter is loaded before
    layout, then one animation frame so the print stylesheet has painted,
    then Chrome's own print pipeline. No popup, no separate HTML report.
    document.fonts is guarded — an unguarded await would throw on a browser
    without the Font Loading API and the dialog would never open.
  */
  async function handlePrint() {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    requestAnimationFrame(() => {
      printReport("npsGpfDeduction");
    });
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadNpsGpfDeductionExcel(filters);
    } catch (error) {
      setMessage(error.message || "Could not export the report.");
    } finally {
      setExporting(false);
    }
  }

  /* Search over the fields the user identifies rows by. */
  const rows = useMemo(() => {
    const all = report?.rows || [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((row) =>
      [
        row.employeeCode, row.employeeName, row.instituteCode,
        row.instituteName, row.salaryMonth, row.billMonth,
      ]
        .map((v) => String(v || "").toLowerCase())
        .some((v) => v.includes(term))
    );
  }, [report, search]);

  /* Totals follow the visible rows so a search never shows a stale total. */
  const totals = useMemo(() => {
    if (!report) return { gpfDeduction: 0, npsDeduction: 0, totalDeduction: 0 };
    if (!search.trim()) return report.totals;
    return rows.reduce(
      (acc, row) => ({
        gpfDeduction: Number((acc.gpfDeduction + Number(row.gpfDeduction || 0)).toFixed(2)),
        npsDeduction: Number((acc.npsDeduction + Number(row.npsDeduction || 0)).toFixed(2)),
        totalDeduction: Number((acc.totalDeduction + Number(row.totalDeduction || 0)).toFixed(2)),
      }),
      { gpfDeduction: 0, npsDeduction: 0, totalDeduction: 0 }
    );
  }, [report, rows, search]);

  const exportRows = useMemo(
    () =>
      rows.map((row) => {
        const out = {};
        COLUMNS.forEach((column) => {
          out[column.key] = MONEY_KEYS.includes(column.key)
            ? money(row[column.key])
            : row[column.key];
        });
        return out;
      }),
    [rows]
  );

  return (
    <div className="ngd-page">
      <div className="ngd-toolbar no-print">
        <button type="button" className="ngd-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="ngd-filters no-print" onSubmit={handleShow}>
        <div className="ngd-field">
          <label htmlFor="ngd-section">SECTION</label>
          <select
            id="ngd-section"
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setInstituteCode("");
              setEmployeeId("");
            }}
          >
            <option value="">All Sections</option>
            {sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.sectionName}
              </option>
            ))}
          </select>
        </div>

        <div className="ngd-field ngd-field-wide">
          <label htmlFor="ngd-institute">INSTITUTE</label>
          <select
            id="ngd-institute"
            value={instituteCode}
            onChange={(e) => {
              setInstituteCode(e.target.value);
              setEmployeeId("");
            }}
          >
            <option value="">All Institutes</option>
            {visibleInstitutes.map((i) => {
              const code = i.instituteCode ?? i.InstituteCode;
              const name = i.instituteName ?? i.InstituteName ?? code;
              return (
                <option key={code} value={code}>
                  {code} - {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="ngd-field ngd-field-wide">
          <label htmlFor="ngd-employee">EMPLOYEE</label>
          <select
            id="ngd-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">All Employees</option>
            {visibleEmployees.map((e) => {
              const id = e.employeeId ?? e.EmployeeId;
              const name = e.employeeName ?? e.EmployeeName ?? "";
              return (
                <option key={id} value={id}>
                  {id} - {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="ngd-field">
          <label htmlFor="ngd-from-month">FROM SALARY MONTH</label>
          <div className="ngd-month-pair">
            <select
              id="ngd-from-month"
              value={fromMonth}
              disabled={allMonths}
              onChange={(e) => setFromMonth(e.target.value)}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={fromYear}
              disabled={allMonths}
              onChange={(e) => setFromYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ngd-field">
          <label htmlFor="ngd-to-month">TO SALARY MONTH</label>
          <div className="ngd-month-pair">
            <select
              id="ngd-to-month"
              value={toMonth}
              disabled={allMonths}
              onChange={(e) => setToMonth(e.target.value)}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={toYear}
              disabled={allMonths}
              onChange={(e) => setToYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ngd-field ngd-field-check">
          <label htmlFor="ngd-all-months">
            <input
              id="ngd-all-months"
              type="checkbox"
              checked={allMonths}
              onChange={(e) => setAllMonths(e.target.checked)}
            />
            All Salary Months
          </label>
        </div>

        <div className="ngd-field">
          <label htmlFor="ngd-type">BILL TYPE</label>
          <select
            id="ngd-type"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
          </select>
        </div>

        <div className="ngd-field">
          <label htmlFor="ngd-salary-category">SALARY TYPE</label>
          <select
            id="ngd-salary-category"
            value={salaryCategory}
            onChange={(e) => setSalaryCategory(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="DA_DIFFERENCE">DA Difference Salary</option>
          </select>
        </div>

        <div className="ngd-field">
          <label htmlFor="ngd-deduction">DEDUCTION</label>
          <select
            id="ngd-deduction"
            value={deductionType}
            onChange={(e) => setDeductionType(e.target.value)}
          >
            <option value="ALL">All (GPF + NPS)</option>
            <option value="GPF">GPF only</option>
            <option value="NPS">NPS only</option>
          </select>
        </div>

        <div className="ngd-field ngd-field-action">
          <button type="submit" className="ngd-btn primary" disabled={loading}>
            {loading ? "Loading..." : "Show"}
          </button>
        </div>
      </form>

      {message ? <div className="ngd-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="ngd-sheet">
          <div className="ngd-head">
            <div className="ngd-head-line">{report.heading}</div>
            <div className="ngd-head-line ngd-head-title">{report.subHeading}</div>
            <div className="ngd-head-line">
              Salary Type: {report.salaryCategoryLabel}
            </div>
          </div>

          <div className="ngd-search no-print">
            <input
              type="search"
              placeholder="Search employee, institute or month..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="ngd-count">{rows.length} row(s)</span>
          </div>

          <div className="ngd-table-wrap">
            <table className="ngd-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={MONEY_KEYS.includes(column.key) ? "ngd-n" : ""}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.detailId || row.billCode}-${row.srNo}`}>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={
                          MONEY_KEYS.includes(column.key) ? "ngd-n" : "ngd-c"
                        }
                      >
                        {MONEY_KEYS.includes(column.key)
                          ? money(row[column.key])
                          : row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ngd-c ngd-bold" colSpan={11}>
                    TOTAL
                  </td>
                  <td className="ngd-n ngd-bold">{money(totals.gpfDeduction)}</td>
                  <td className="ngd-n ngd-bold">{money(totals.npsDeduction)}</td>
                  <td className="ngd-n ngd-bold">{money(totals.totalDeduction)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {report.salaryCategory === "ALL" && report.categoryTotals ? (
            <div className="ngd-grand ngd-grand-split">
              <div>
                <span>Regular Salary Total</span>
                <strong>{money(report.categoryTotals.regular.totalDeduction)}</strong>
              </div>
              <div>
                <span>DA Difference Salary Total</span>
                <strong>
                  {money(report.categoryTotals.daDifference.totalDeduction)}
                </strong>
              </div>
              <div>
                <span>Grand Total</span>
                <strong>{money(report.categoryTotals.grand.totalDeduction)}</strong>
              </div>
            </div>
          ) : null}

          <div className="ngd-grand">
            <div>
              <span>Total GPF Deduction</span>
              <strong>{money(totals.gpfDeduction)}</strong>
            </div>
            <div>
              <span>Total NPS Deduction</span>
              <strong>{money(totals.npsDeduction)}</strong>
            </div>
            <div>
              <span>Grand Total Deduction</span>
              <strong>{money(totals.totalDeduction)}</strong>
            </div>
          </div>

          <div className="ngd-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="ngd-actions no-print">
            <GridToolbar
              reportName="npsGpfDeduction"
              title="NPS GPF Deduction Report"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print", "pdf"]}
            />
            <div className="ngd-actions-main">
              <button
                type="button"
                className="ngd-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button type="button" className="ngd-btn" onClick={handlePrint}>
                PDF
              </button>
              <button type="button" className="ngd-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
