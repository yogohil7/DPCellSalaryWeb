import React, { useEffect, useMemo, useState } from "react";
import DataGrid from "../components/DataGrid";
import { listSalaryBillCodes } from "../utils/salaryBillCodeApi";
import { listInstitutes } from "../utils/instituteApi";
import { getSalaryVariationReport } from "../utils/salaryVariationApi";
import "./salaryVariationReport.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const money = (value) =>
  toNumber(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const signedMoney = (value) => {
  const n = toNumber(value);
  const formatted = money(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
};

const variationClass = (value) => {
  const n = toNumber(value);
  if (n > 0) return "var-positive";
  if (n < 0) return "var-negative";
  return "var-zero";
};

const dgVarClass = (value) => {
  const n = toNumber(value);
  if (n > 0) return "dg-var-positive";
  if (n < 0) return "dg-var-negative";
  return "";
};

/** Component fields for PREV / CURR / Variation columns (order matches report). */
const COMPARISON_FIELDS = [
  { key: "basic", label: "Basic", prevLabel: "Previous Basic", currLabel: "Current Basic", varLabel: "Basic Variation" },
  { key: "gradePay", label: "Grade Pay", prevLabel: "Previous Grade Pay", currLabel: "Current Grade Pay", varLabel: "Grade Pay Variation" },
  { key: "totalBasic", label: "Total Basic", prevLabel: "Previous Total Basic", currLabel: "Current Total Basic", varLabel: "Total Basic Variation" },
  { key: "da", label: "DA", prevLabel: "Previous DA", currLabel: "Current DA", varLabel: "DA Variation" },
  { key: "hra", label: "HRA", prevLabel: "Previous HRA", currLabel: "Current HRA", varLabel: "HRA Variation" },
  { key: "ma", label: "MA", prevLabel: "Previous MA", currLabel: "Current MA", varLabel: "MA Variation" },
  { key: "ta", label: "TA", prevLabel: "Previous TA", currLabel: "Current TA", varLabel: "TA Variation" },
  {
    key: "specialAllowance",
    label: "Special Allowance",
    prevLabel: "Previous Special Allowance",
    currLabel: "Current Special Allowance",
    varLabel: "Special Allowance Variation",
  },
  {
    key: "washingAllowance",
    label: "Washing Allowance",
    prevLabel: "Previous Washing Allowance",
    currLabel: "Current Washing Allowance",
    varLabel: "Washing Allowance Variation",
  },
  {
    key: "gross",
    label: "Gross Salary",
    prevLabel: "Previous Gross Salary",
    currLabel: "Current Gross Salary",
    varLabel: "Gross Variation",
  },
  {
    key: "gpfSubscription",
    label: "GPF Subscription",
    prevLabel: "Previous GPF Subscription",
    currLabel: "Current GPF Subscription",
    varLabel: "GPF Variation",
  },
  {
    key: "gpfAdvance",
    label: "GPF Advance",
    prevLabel: "Previous GPF Advance",
    currLabel: "Current GPF Advance",
    varLabel: "GPF Advance Variation",
  },
  { key: "nps", label: "NPS", prevLabel: "Previous NPS", currLabel: "Current NPS", varLabel: "NPS Variation" },
  {
    key: "incomeTax",
    label: "Income Tax",
    prevLabel: "Previous Income Tax",
    currLabel: "Current Income Tax",
    varLabel: "Income Tax Variation",
  },
  {
    key: "professionalTax",
    label: "Professional Tax",
    prevLabel: "Previous Professional Tax",
    currLabel: "Current Professional Tax",
    varLabel: "Professional Tax Variation",
  },
  {
    key: "otherDeduction",
    label: "Other Deduction",
    prevLabel: "Previous Other Deduction",
    currLabel: "Current Other Deduction",
    varLabel: "Other Deduction Variation",
  },
  {
    key: "totalDeduction",
    label: "Total Deduction",
    prevLabel: "Previous Total Deduction",
    currLabel: "Current Total Deduction",
    varLabel: "Deduction Variation",
  },
  {
    key: "netSalary",
    label: "Net Salary",
    prevLabel: "Previous Net Salary",
    currLabel: "Current Net Salary",
    varLabel: "Net Variation",
  },
];

function pairValue(row, fieldKey, side) {
  const pair = row?.[fieldKey];
  if (!pair) return 0;
  return toNumber(pair[side]);
}

function buildEmployeeColumns() {
  const amountCol = (key, label, fieldKey, side, isVariation) => ({
    key,
    label,
    width: 120,
    align: "right",
    type: "number",
    getValue: (row) =>
      isVariation
        ? signedMoney(pairValue(row, fieldKey, "variation"))
        : money(pairValue(row, fieldKey, side)),
    render: (row) => {
      const value = pairValue(row, fieldKey, isVariation ? "variation" : side);
      const text = isVariation ? signedMoney(value) : money(value);
      return (
        <span className={isVariation ? dgVarClass(value) : undefined}>{text}</span>
      );
    },
  });

  const columns = [
    {
      key: "employeeId",
      label: "Employee ID",
      width: 110,
      align: "left",
      getValue: (row) => String(row.employeeId ?? ""),
    },
    {
      key: "employeeName",
      label: "Employee Name",
      width: 180,
      align: "left",
      getValue: (row) => row.employeeName || "",
    },
    {
      key: "designation",
      label: "Designation",
      width: 150,
      align: "left",
      getValue: (row) => row.designation || "",
    },
    {
      key: "status",
      label: "Employee Status",
      width: 120,
      align: "center",
      type: "status",
      getValue: (row) => row.status || "",
    },
  ];

  COMPARISON_FIELDS.forEach((field) => {
    columns.push(
      amountCol(`${field.key}_prev`, field.prevLabel, field.key, "previous", false),
      amountCol(`${field.key}_curr`, field.currLabel, field.key, "current", false),
      amountCol(`${field.key}_var`, field.varLabel, field.key, "variation", true)
    );
  });

  return columns;
}

const EMPLOYEE_COLUMNS = buildEmployeeColumns();

function downloadExcel(filename, header, body) {
  const escape = (cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...body].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SalaryVariationReport({
  onBack,
  initialPreviousBillCode = "",
  initialCurrentBillCode = "",
  initialInstituteCode = "",
  initialInstituteId = null,
}) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("salaryVariationReport");
  const [billCodes, setBillCodes] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [previousBillCode, setPreviousBillCode] = useState(
    initialPreviousBillCode || ""
  );
  const [currentBillCode, setCurrentBillCode] = useState(
    initialCurrentBillCode || ""
  );
  const [instituteCode, setInstituteCode] = useState(
    initialInstituteCode || ""
  );
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  const [filterEmployeeType, setFilterEmployeeType] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterDesignation, setFilterDesignation] = useState("");
  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [filterChange, setFilterChange] = useState("ALL");

  useEffect(() => {
    let active = true;
    setLoadingMeta(true);
    Promise.all([listSalaryBillCodes(), listInstitutes()])
      .then(([bills, inst]) => {
        if (!active) return;
        const billList = Array.isArray(bills) ? bills : [];
        const instList = (Array.isArray(inst) ? inst : []).map((row) => ({
          id: row.instituteId ?? row.id,
          code: row.instituteCode || row.code || "",
          name: row.instituteName || row.name || "",
        }));
        setBillCodes(billList);
        setInstitutes(instList);

        if (!currentBillCode && initialCurrentBillCode) {
          setCurrentBillCode(initialCurrentBillCode);
        }
        if (!instituteCode) {
          if (initialInstituteCode) {
            setInstituteCode(initialInstituteCode);
          } else if (initialInstituteId) {
            const match = instList.find(
              (row) => Number(row.id) === Number(initialInstituteId)
            );
            if (match) setInstituteCode(match.code);
          } else if (instList.length) {
            setInstituteCode(instList[0].code);
          }
        }
      })
      .catch(() => {
        if (!active) return;
        setError("Unable to load bill codes or institutes.");
      })
      .finally(() => {
        if (active) setLoadingMeta(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedInstitute = useMemo(
    () => institutes.find((row) => row.code === instituteCode) || null,
    [institutes, instituteCode]
  );

  const handleGetReport = async () => {
    setError("");
    setSelectedEmployeeId(null);

    if (!previousBillCode) {
      setError("Please select Previous Salary Bill.");
      return;
    }
    if (!currentBillCode) {
      setError("Please select Current Salary Bill.");
      return;
    }
    if (previousBillCode === currentBillCode) {
      setError("Previous Bill and Current Bill cannot be the same.");
      return;
    }
    if (!instituteCode) {
      setError("Please select Institute.");
      return;
    }

    try {
      setLoadingReport(true);
      const result = await getSalaryVariationReport({
        previousBillCode,
        currentBillCode,
        instituteCode,
        instituteId: selectedInstitute?.id,
      });
      setMeta(result.meta || null);
      setSummary(result.summary || null);
      setEmployees(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setMeta(null);
      setSummary(null);
      setEmployees([]);
      setError(err.message || "Unable to load variation report.");
    } finally {
      setLoadingReport(false);
    }
  };

  const employeeTypes = useMemo(() => {
    const set = new Set();
    employees.forEach((row) => {
      if (row.employeeType) set.add(row.employeeType);
    });
    return Array.from(set).sort();
  }, [employees]);

  const sections = useMemo(() => {
    const set = new Set();
    employees.forEach((row) => {
      if (row.section) set.add(row.section);
    });
    return Array.from(set).sort();
  }, [employees]);

  const designations = useMemo(() => {
    const set = new Set();
    employees.forEach((row) => {
      if (row.designation) set.add(row.designation);
    });
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((row) => {
      if (filterEmployeeType && row.employeeType !== filterEmployeeType) {
        return false;
      }
      if (filterSection && row.section !== filterSection) return false;
      if (filterDesignation && row.designation !== filterDesignation) {
        return false;
      }
      if (filterEmployeeId && String(row.employeeId) !== String(filterEmployeeId)) {
        return false;
      }
      if (filterChange === "NEW" && row.status !== "NEW") return false;
      if (filterChange === "REMOVED" && row.status !== "REMOVED") return false;
      if (filterChange === "CHANGED" && !row.hasChange) return false;
      if (filterChange === "UNCHANGED" && row.hasChange) return false;
      return true;
    });
  }, [
    employees,
    filterEmployeeType,
    filterSection,
    filterDesignation,
    filterEmployeeId,
    filterChange,
  ]);

  const selectedEmployee = useMemo(
    () =>
      employees.find((row) => row.employeeId === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const handlePrint = () => {
    printReport("salaryVariationReport");
  };

  const handleExport = () => {
    if (!employees.length) {
      alert("Load a report before exporting.");
      return;
    }

    const header = [
      "Employee ID",
      "Employee Name",
      "Designation",
      "Employee Status",
      ...COMPARISON_FIELDS.flatMap((field) => [
        field.prevLabel,
        field.currLabel,
        field.varLabel,
      ]),
    ];

    const body = filteredEmployees.map((row) => [
      row.employeeId,
      row.employeeName,
      row.designation,
      row.status,
      ...COMPARISON_FIELDS.flatMap((field) => [
        pairValue(row, field.key, "previous"),
        pairValue(row, field.key, "current"),
        pairValue(row, field.key, "variation"),
      ]),
    ]);

    downloadExcel(
      `Salary-Variation-${previousBillCode}-vs-${currentBillCode}`,
      header,
      body
    );
  };

  return (
    <div className="svr-page">
      <div className="svr-back no-print">
        <button type="button" className="svr-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <div className="svr-title-row">
        <div>
          <h1>SALARY VARIATION REPORT</h1>
          <p className="svr-subtitle">
            Read-only comparison between two salary bills
          </p>
        </div>
        <div className="svr-actions no-print">
          <button type="button" className="svr-btn" onClick={handlePrint}>
            Print
          </button>
          <button type="button" className="svr-btn" onClick={handleExport}>
            Export Excel
          </button>
        </div>
      </div>

      <section className="svr-card no-print">
        <div className="svr-filters">
          <label>
            <span>Previous Salary Bill</span>
            <select
              value={previousBillCode}
              disabled={loadingMeta}
              onChange={(e) => setPreviousBillCode(e.target.value)}
            >
              <option value="">Select Previous Bill</option>
              {billCodes.map((row) => (
                <option key={row.billCode} value={row.billCode}>
                  {row.billCode} ({String(row.status || "").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Current Salary Bill</span>
            <select
              value={currentBillCode}
              disabled={loadingMeta}
              onChange={(e) => setCurrentBillCode(e.target.value)}
            >
              <option value="">Select Current Bill</option>
              {billCodes.map((row) => (
                <option key={`c-${row.billCode}`} value={row.billCode}>
                  {row.billCode} ({String(row.status || "").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Institute</span>
            <select
              value={instituteCode}
              disabled={loadingMeta || institutes.length === 0}
              onChange={(e) => setInstituteCode(e.target.value)}
            >
              <option value="">Select Institute</option>
              {institutes.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.code} — {row.name}
                </option>
              ))}
            </select>
          </label>

          <div className="svr-filter-action">
            <button
              type="button"
              className="svr-btn svr-btn-primary"
              disabled={loadingReport || loadingMeta}
              onClick={handleGetReport}
            >
              {loadingReport ? "Loading..." : "GET REPORT"}
            </button>
          </div>
        </div>
        {error ? <div className="svr-error">{error}</div> : null}
      </section>

      {meta ? (
        <section className="svr-card svr-print-header">
          <div className="svr-meta-grid">
            <div>
              <span>Previous Bill</span>
              <strong>
                {meta.previousBillCode} ({meta.previousStatus})
              </strong>
            </div>
            <div>
              <span>Current Bill</span>
              <strong>
                {meta.currentBillCode} ({meta.currentStatus})
              </strong>
            </div>
            <div>
              <span>Institute</span>
              <strong>
                {meta.instituteCode} — {meta.instituteName}
              </strong>
            </div>
            <div>
              <span>Report Date</span>
              <strong>
                {meta.reportDate
                  ? new Date(meta.reportDate).toLocaleString("en-IN")
                  : "-"}
              </strong>
            </div>
          </div>
        </section>
      ) : null}

      {summary ? (
        <>
          <section className="svr-summary-cards">
            <div className="svr-stat">
              <span>Employees Previous</span>
              <strong>{summary.totalEmployeesPrevious}</strong>
            </div>
            <div className="svr-stat">
              <span>Employees Current</span>
              <strong>{summary.totalEmployeesCurrent}</strong>
            </div>
            <div className="svr-stat">
              <span>New</span>
              <strong>{summary.newEmployees}</strong>
            </div>
            <div className="svr-stat">
              <span>Removed</span>
              <strong>{summary.removedEmployees}</strong>
            </div>
            <div className="svr-stat">
              <span>Continued</span>
              <strong>{summary.continuedEmployees}</strong>
            </div>
          </section>

          <section className="svr-summary-cards">
            <div className="svr-stat">
              <span>Previous Gross</span>
              <strong>{money(summary.previousGross)}</strong>
            </div>
            <div className="svr-stat">
              <span>Current Gross</span>
              <strong>{money(summary.currentGross)}</strong>
            </div>
            <div className={`svr-stat ${variationClass(summary.grossVariation)}`}>
              <span>Gross Variation</span>
              <strong>{signedMoney(summary.grossVariation)}</strong>
            </div>
            <div className="svr-stat">
              <span>Previous Deduction</span>
              <strong>{money(summary.previousDeduction)}</strong>
            </div>
            <div className="svr-stat">
              <span>Current Deduction</span>
              <strong>{money(summary.currentDeduction)}</strong>
            </div>
            <div
              className={`svr-stat ${variationClass(summary.deductionVariation)}`}
            >
              <span>Deduction Variation</span>
              <strong>{signedMoney(summary.deductionVariation)}</strong>
            </div>
            <div className="svr-stat">
              <span>Previous Net</span>
              <strong>{money(summary.previousNetSalary)}</strong>
            </div>
            <div className="svr-stat">
              <span>Current Net</span>
              <strong>{money(summary.currentNetSalary)}</strong>
            </div>
            <div
              className={`svr-stat ${variationClass(summary.netSalaryVariation)}`}
            >
              <span>Net Variation</span>
              <strong>{signedMoney(summary.netSalaryVariation)}</strong>
            </div>
          </section>
        </>
      ) : null}

      {summary?.componentSummary?.length ? (
        <section className="svr-card">
          <h2>Component Summary</h2>
          <div className="svr-table-wrap">
            <table className="svr-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num">Previous Total</th>
                  <th className="num">Current Total</th>
                  <th className="num">Variation</th>
                </tr>
              </thead>
              <tbody>
                {summary.componentSummary.map((row) => (
                  <tr key={row.component}>
                    <td>{row.component}</td>
                    <td className="num">{money(row.previous)}</td>
                    <td className="num">{money(row.current)}</td>
                    <td className={`num ${variationClass(row.variation)}`}>
                      {signedMoney(row.variation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {employees.length ? (
        <section className="svr-card no-print">
          <div className="svr-secondary-filters">
            <label>
              <span>Employee</span>
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
              >
                <option value="">All</option>
                {employees.map((row) => (
                  <option key={row.employeeId} value={row.employeeId}>
                    {row.employeeId} — {row.employeeName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Employee Type</span>
              <select
                value={filterEmployeeType}
                onChange={(e) => setFilterEmployeeType(e.target.value)}
              >
                <option value="">All</option>
                {employeeTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Section</span>
              <select
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
              >
                <option value="">All</option>
                {sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Designation</span>
              <select
                value={filterDesignation}
                onChange={(e) => setFilterDesignation(e.target.value)}
              >
                <option value="">All</option>
                {designations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Show</span>
              <select
                value={filterChange}
                onChange={(e) => setFilterChange(e.target.value)}
              >
                <option value="ALL">All</option>
                <option value="NEW">New</option>
                <option value="REMOVED">Removed</option>
                <option value="CHANGED">Changed</option>
                <option value="UNCHANGED">Unchanged</option>
              </select>
            </label>
          </div>
        </section>
      ) : null}

      {employees.length ? (
        <section className="svr-card svr-employee-grid">
          <h2 className="svr-print-only-title">Employee-wise Variation</h2>
          <DataGrid
            title="Employee-wise Variation"
            columns={EMPLOYEE_COLUMNS}
            rows={filteredEmployees}
            rowKey="employeeId"
            stickyLeft={4}
            defaultPageSize={25}
            emptyText="No employees match the current filters."
            onRowClick={(row) => setSelectedEmployeeId(row.employeeId)}
            selectedKey={selectedEmployeeId}
          />
        </section>
      ) : null}

      {/* Print-only wide table (DataGrid toolbar/pagination hidden in print) */}
      {employees.length ? (
        <section className="svr-card svr-print-employee-table">
          <h2>Employee-wise Variation</h2>
          <div className="svr-table-wrap">
            <table className="svr-table svr-wide-print-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Designation</th>
                  <th>Employee Status</th>
                  {COMPARISON_FIELDS.map((field) => (
                    <React.Fragment key={field.key}>
                      <th className="num">{field.prevLabel}</th>
                      <th className="num">{field.currLabel}</th>
                      <th className="num">{field.varLabel}</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((row) => (
                  <tr key={row.employeeId}>
                    <td>{row.employeeId}</td>
                    <td>{row.employeeName}</td>
                    <td>{row.designation}</td>
                    <td>{row.status}</td>
                    {COMPARISON_FIELDS.map((field) => (
                      <React.Fragment key={field.key}>
                        <td className="num">
                          {money(pairValue(row, field.key, "previous"))}
                        </td>
                        <td className="num">
                          {money(pairValue(row, field.key, "current"))}
                        </td>
                        <td
                          className={`num ${variationClass(
                            pairValue(row, field.key, "variation")
                          )}`}
                        >
                          {signedMoney(pairValue(row, field.key, "variation"))}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedEmployee ? (
        <div className="svr-modal-backdrop no-print" role="dialog">
          <div className="svr-modal">
            <div className="svr-modal-head">
              <h2>Employee Variation Details</h2>
              <button
                type="button"
                className="svr-link"
                onClick={() => setSelectedEmployeeId(null)}
              >
                Close
              </button>
            </div>
            <div className="svr-modal-body">
              <div className="svr-meta-grid">
                <div>
                  <span>Employee</span>
                  <strong>
                    {selectedEmployee.employeeId} —{" "}
                    {selectedEmployee.employeeName}
                  </strong>
                </div>
                <div>
                  <span>Type</span>
                  <strong>{selectedEmployee.employeeType}</strong>
                </div>
                <div>
                  <span>Designation</span>
                  <strong>{selectedEmployee.designation || "-"}</strong>
                </div>
                <div>
                  <span>Section</span>
                  <strong>{selectedEmployee.section || "-"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{selectedEmployee.status}</strong>
                </div>
                <div>
                  <span>Previous / Current Bill</span>
                  <strong>
                    {meta?.previousBillCode} → {meta?.currentBillCode}
                  </strong>
                </div>
              </div>

              {(selectedEmployee.reasons || []).length ? (
                <div className="svr-reasons">
                  <span>Remarks</span>
                  <ul>
                    {selectedEmployee.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <table className="svr-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="num">Previous</th>
                    <th className="num">Current</th>
                    <th className="num">Variation</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedEmployee.components || []).map((c) => (
                    <tr key={c.code}>
                      <td>{c.label}</td>
                      <td className="num">{money(c.previous)}</td>
                      <td className="num">{money(c.current)}</td>
                      <td className={`num ${variationClass(c.variation)}`}>
                        {signedMoney(c.variation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
