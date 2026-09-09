import { useEffect, useMemo, useState } from "react";
import {
  getIncomeTaxProfessionalTax,
  downloadIncomeTaxProfessionalTaxExcel,
} from "../utils/incomeTaxProfessionalTaxApi";
import { getEmployeeWiseSalaryMeta } from "../utils/employeeWiseSalaryApi";
import { listInstitutes } from "../utils/instituteApi";
import { GridToolbar } from "../components/DataGrid";
import "./incomeTaxProfessionalTax.css";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* The fourteen printed columns, in order. */
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
  { key: "salaryTypeLabel", label: "Salary Type" },
  { key: "incomeTax", label: "Income Tax" },
  { key: "professionalTax", label: "Professional Tax" },
  { key: "total", label: "Total" },
];

const AMOUNT_KEYS = new Set(["incomeTax", "professionalTax", "total"]);

const DEDUCTION_TYPES = [
  { value: "ALL", label: "All" },
  { value: "INCOME_TAX", label: "Income Tax" },
  { value: "PROFESSIONAL_TAX", label: "Professional Tax" },
];

const SALARY_TYPES = [
  { value: "ALL", label: "All" },
  { value: "REGULAR", label: "Regular (incl. Old)" },
  { value: "OLD", label: "Old" },
];

export default function IncomeTaxProfessionalTax({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [years, setYears] = useState([]);

  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [billMonth, setBillMonth] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [salaryType, setSalaryType] = useState("ALL");
  const [deductionType, setDeductionType] = useState("ALL");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, instituteList] = await Promise.all([
          getEmployeeWiseSalaryMeta(),
          listInstitutes(),
        ]);
        if (cancelled) return;
        const metaData = meta?.data || {};
        setSections(
          (metaData.sections || []).filter((s) => s.sectionId != null)
        );
        const yearList = (metaData.years || []).map(String);
        setYears(yearList.length ? yearList : [String(new Date().getFullYear())]);
        const rows = Array.isArray(instituteList)
          ? instituteList
          : instituteList?.data || [];
        setInstitutes(rows);
      } catch (error) {
        if (!cancelled) setMessage(error.message || "Could not load the filters.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleInstitutes = useMemo(() => {
    if (!sectionId) return institutes;
    return institutes.filter(
      (i) => String(i.sectionId ?? i.SectionId ?? "") === String(sectionId)
    );
  }, [institutes, sectionId]);

  const filters = useMemo(
    () => ({
      month,
      year,
      billMonth: billMonth || undefined,
      sectionId: sectionId || undefined,
      instituteCode: instituteCode || undefined,
      salaryType,
      deductionType,
    }),
    [month, year, billMonth, sectionId, instituteCode, salaryType, deductionType]
  );

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
        srNo: "", employeeCode: "", employeeName: "TOTAL",
        designation: "", sectionName: "", instituteCode: "",
        instituteName: "", salaryMonth: "", billMonth: "",
        billType: "", salaryTypeLabel: "",
        incomeTax: money(report.totals.incomeTax),
        professionalTax: money(report.totals.professionalTax),
        total: money(report.totals.total),
      },
    ];
  }, [rows, report]);

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getIncomeTaxProfessionalTax(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage(
          "No Income Tax or Professional Tax deductions found for the selected criteria."
        );
      }
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
      await downloadIncomeTaxProfessionalTaxExcel(filters);
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
      window.print();
    });
  }

  const summary = report
    ? [
        `Salary Month: ${MONTHS[Number(month) - 1]}-${year}`,
        billMonth ? `Bill Month: ${MONTHS[Number(billMonth) - 1]}` : "Bill Month: ALL",
        `Salary Type: ${report.filters.salaryType}`,
        `Deduction Type: ${report.filters.deductionType}`,
        instituteCode ? `Institute: ${instituteCode}` : "Institute: ALL",
      ].join("     ")
    : "";

  return (
    <div className="itp-page">
      <div className="itp-toolbar no-print">
        <button type="button" className="itp-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="itp-filters no-print" onSubmit={handleShow}>
        <div className="itp-field">
          <label>Salary Year</label>
          {years.length ? (
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
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

        <div className="itp-field">
          <label>Salary Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="itp-field">
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

        <div className="itp-field">
          <label>Section</label>
          <select
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setInstituteCode("");
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

        <div className="itp-field">
          <label>Institute</label>
          <select
            value={instituteCode}
            onChange={(e) => setInstituteCode(e.target.value)}
          >
            <option value="">All Institutes</option>
            {visibleInstitutes.map((i) => {
              const code = i.instituteCode ?? i.InstituteCode ?? "";
              const name = i.instituteName ?? i.InstituteName ?? code;
              return (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="itp-field">
          <label>Salary Type</label>
          <select
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            {SALARY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="itp-field">
          <label>Deduction Type</label>
          <select
            value={deductionType}
            onChange={(e) => setDeductionType(e.target.value)}
          >
            {DEDUCTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="itp-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="itp-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="itp-sheet">
          <div className="itp-head">
            <div className="itp-head-line">{report.heading}</div>
            <div className="itp-head-line itp-title">{report.subHeading}</div>
          </div>

          <div className="itp-filter-summary">{summary}</div>

          {/* The DA-Difference exclusion is stated, never left implied. */}
          <div className="itp-scope-note">{report.scopeNote}</div>

          <div className="itp-table-wrap">
            <table className="itp-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={AMOUNT_KEYS.has(column.key) ? "itp-amt" : ""}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.detailId}-${row.billCodeId}-${row.employeeId}`}
                  >
                    {COLUMNS.map((column) => {
                      if (AMOUNT_KEYS.has(column.key)) {
                        return (
                          <td key={column.key} className="itp-amt">
                            {money(row[column.key])}
                          </td>
                        );
                      }
                      if (
                        column.key === "employeeName" ||
                        column.key === "instituteName"
                      ) {
                        return (
                          <td key={column.key} className="itp-name">
                            {row[column.key]}
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
                  <td className="itp-name">TOTAL</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="itp-amt">{money(report.totals.incomeTax)}</td>
                  <td className="itp-amt">
                    {money(report.totals.professionalTax)}
                  </td>
                  <td className="itp-amt">{money(report.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="itp-summary">
            <div className="itp-summary-item">
              <span>Employee Count</span>
              {report.employeeCount}
            </div>
            <div className="itp-summary-item">
              <span>Income Tax Total</span>
              {money(report.totals.incomeTax)}
            </div>
            <div className="itp-summary-item">
              <span>Professional Tax Total</span>
              {money(report.totals.professionalTax)}
            </div>
            <div className="itp-summary-item">
              <span>Total Deduction</span>
              {money(report.totals.total)}
            </div>
          </div>

          <div className="itp-actions no-print">
            <GridToolbar
              title="Income Tax & Professional Tax"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={true}
              hiddenActions={["excel", "print"]}
            />
            <button
              type="button"
              className="itp-btn"
              onClick={handleExcel}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export Excel"}
            </button>
            <button type="button" className="itp-btn itp-btn-ghost" onClick={handlePrint}>
              PDF
            </button>
            <button type="button" className="itp-btn itp-btn-ghost" onClick={handlePrint}>
              Print
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
