import { useEffect, useState } from "react";
import {
  getSalaryRegisterDetail,
  downloadSalaryRegisterDetailExcel,
} from "../utils/salaryRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./salaryRegister.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/* Same amount formatting every other report uses. */
function money(value) {
  if (value == null) return "—";
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* Mirrors backend/routes/salaryRegister.js's DETAIL_XLSX_COLUMNS exactly, so
   the screen, the CSV/Copy export and the Excel download can never disagree
   about which columns exist or their order. Every key here is a column that
   genuinely exists in dbo.SalaryEmployeeDetails / SalaryEntryBillEmployee
   Details (or, for Employee Code, dbo.EmployeeMaster) — see that file's doc
   comment. There is no PAN column anywhere in this schema, so Employee Code
   is shown as the employee's existing identifier instead. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "employeeId", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "employeeCode", label: "Employee Code" },
  { key: "basicPay", label: "Basic Pay" },
  { key: "payLevel", label: "Pay Level" },
  { key: "gradePay", label: "Grade Pay" },
  { key: "da", label: "D.A." },
  { key: "hra", label: "H.R.A." },
  { key: "ta", label: "T.A." },
  { key: "ma", label: "M.A." },
  { key: "cla", label: "C.L.A." },
  { key: "otherAllowances", label: "Other Allowances" },
  { key: "grossSalary", label: "Gross Salary" },
  { key: "gpfSubscription", label: "GPF Subscription" },
  { key: "nps", label: "NPS" },
  { key: "gpfAdvance", label: "GPF Advance" },
  { key: "incomeTax", label: "Income Tax" },
  { key: "professionalTax", label: "Professional Tax" },
  { key: "otherDeduction", label: "Other Deduction" },
  { key: "totalDeduction", label: "Total Deduction" },
  { key: "netSalary", label: "Net Salary" },
  { key: "chequeAmount", label: "Cheque Amount" },
];

const AMOUNT_KEYS = new Set([
  "basicPay", "gradePay", "da", "hra", "ta", "ma", "cla", "otherAllowances",
  "grossSalary", "gpfSubscription", "nps", "gpfAdvance", "incomeTax",
  "professionalTax", "otherDeduction", "totalDeduction", "netSalary",
  "chequeAmount",
]);

/* The filter keys Salary Register itself understands — carried through so
   Back restores exactly the list the drill-down was opened from. */
const FILTER_KEYS = ["month", "year", "billMonth", "sectionId", "salaryType"];

export default function SalaryRegisterDetail({ user, pageParams, onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("salaryRegisterDetail");
  const params = pageParams && typeof pageParams === "object" ? pageParams : {};
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  const identity = {
    workflowId: params.workflowId,
    instituteCode: params.instituteCode,
    billCodeId: params.billCodeId,
  };

  useEffect(() => {
    let active = true;
    if (params.workflowId == null || params.workflowId === "") {
      setLoading(false);
      setMessage("No Salary Register row was selected. Go back and click a Salary Month value to open its detail.");
      return () => {};
    }
    setLoading(true);
    setMessage("");
    getSalaryRegisterDetail(identity)
      .then((res) => {
        if (!active) return;
        setReport(res?.data || null);
        if (!res?.data?.employees?.length) {
          setMessage("No employee salary detail found for this bill instance.");
        }
      })
      .catch((error) => {
        if (!active) return;
        setReport(null);
        setMessage(error.message || "Could not load the Salary Details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.workflowId, params.instituteCode, params.billCodeId]);

  const employees = report?.employees || [];

  const exportRows = employees.map((row) => {
    const out = { ...row };
    AMOUNT_KEYS.forEach((key) => {
      out[key] = money(row[key]);
    });
    return out;
  });
  if (report && exportRows.length > 0) {
    const totalRow = { srNo: "", employeeId: "", employeeName: "TOTAL", designation: "", employeeCode: "", payLevel: "" };
    AMOUNT_KEYS.forEach((key) => {
      totalRow[key] = money(report.totals?.[key]);
    });
    exportRows.push(totalRow);
  }

  function backWithFilters() {
    const filters = {};
    FILTER_KEYS.forEach((key) => {
      if (params[key] != null && params[key] !== "") filters[key] = params[key];
    });
    onBack && onBack(filters);
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadSalaryRegisterDetailExcel(identity);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    printReport("salaryRegisterDetail");
  }

  return (
    <div className="sr-page">
      <div className="sr-toolbar no-print">
        <button type="button" className="sr-link" onClick={backWithFilters}>
          ← Back to Salary Register
        </button>
      </div>

      {loading ? <div className="sr-message no-print">Loading...</div> : null}
      {message ? <div className="sr-message no-print">{message}</div> : null}

      {report && employees.length > 0 ? (
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
            <div className="sr-head-line sr-title">{report.title}</div>
          </div>

          <div className="sr-filter-summary">
            Institute Code: {report.bill.instituteCode}&nbsp;&nbsp;&nbsp;
            Institute Name: {report.bill.instituteName}
            <br />
            Bill Code: {report.bill.billCode}&nbsp;&nbsp;&nbsp;
            Bill Month: {report.bill.billMonth}&nbsp;&nbsp;&nbsp;
            Salary Month: {report.bill.salaryMonth}&nbsp;&nbsp;&nbsp;
            Salary Type: {report.bill.salaryType}
            <br />
            Bill No.: {report.bill.billNo || "—"}&nbsp;&nbsp;&nbsp;
            Bill Date: {report.bill.billDate || "—"}
          </div>

          <div className="sr-table-wrap">
            <table className="sr-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={AMOUNT_KEYS.has(column.key) ? "sr-amt" : ""}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <tr key={row.detailId != null ? row.detailId : row.employeeId}>
                    {COLUMNS.map((column) => {
                      if (AMOUNT_KEYS.has(column.key)) {
                        return (
                          <td key={column.key} className="sr-amt">
                            {money(row[column.key])}
                          </td>
                        );
                      }
                      if (column.key === "employeeName") {
                        return (
                          <td key={column.key} className="sr-name">
                            {row.employeeName}
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
                  {COLUMNS.slice(5).map((column) => (
                    <td key={column.key} className={AMOUNT_KEYS.has(column.key) ? "sr-amt" : ""}>
                      {AMOUNT_KEYS.has(column.key) ? money(report.totals?.[column.key]) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="sr-filter-summary" style={{ marginTop: 10 }}>
            Salary Register totals for this bill — Employees: {report.registerTotals.employees}
            &nbsp;&nbsp; Gross: {money(report.registerTotals.grossAmount)}
            &nbsp;&nbsp; Deduction: {money(report.registerTotals.totalDeduction)}
            &nbsp;&nbsp; Net: {money(report.registerTotals.netSalary)}
            &nbsp;&nbsp; Cheque: {money(report.registerTotals.chequeAmount)}
          </div>

          <div className="sr-actions no-print">
            <GridToolbar
              reportName="salaryRegisterDetail"
              subtitle={[
                `${report.bill.instituteCode} — ${report.bill.instituteName}`,
                `Bill Code: ${report.bill.billCode}   Bill Month: ${report.bill.billMonth}   Salary Month: ${report.bill.salaryMonth}`,
              ]}
              title="Salary Details"
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
