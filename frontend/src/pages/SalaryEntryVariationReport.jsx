import React, { useEffect, useMemo, useState } from "react";
import { GridToolbar } from "../components/DataGrid";
import { getSalaryEntryVariationReport } from "../utils/salaryEntryApi";
import { getApprovalVariationReport } from "../utils/salaryBillApprovalApi";
import {
  VARIATION_COMPONENT_FIELDS,
  money,
  signedMoney,
  variationClass,
} from "../utils/salaryVariationFields";
import "./salaryEntryVariationReport.css";

/**
 * Full employee-wise Previous / Current / Variation report.
 * source="approval" uses AO-accessible API with previous-salary-month compare.
 */
export default function SalaryEntryVariationReport({
  billCode,
  billMonth,
  salaryMonth,
  instituteCode,
  onClose,
  source = "salary-entry",
  compareMode,
}) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setReport(null);

    const loader =
      source === "approval"
        ? getApprovalVariationReport({
            billCode,
            instituteCode,
            compareMode: compareMode || "previousSalaryMonth",
          })
        : getSalaryEntryVariationReport({
            billCode,
            instituteCode,
            salaryMonth,
            compareMode: compareMode || "auto",
          });

    loader
      .then((result) => {
        if (active) setReport(result?.data || result);
      })
      .catch((err) => {
        if (active) setError(err.message || "Unable to load variation report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [billCode, instituteCode, salaryMonth, source, compareMode]);

  const fields = report?.fields?.length
    ? report.fields
    : VARIATION_COMPONENT_FIELDS;

  const earningFields = fields.filter((f) => f.group === "EARNING");
  const deductionFields = fields.filter((f) => f.group === "DEDUCTION");
  const totalFields = fields.filter((f) => f.group === "TOTAL");

  const rows = report?.comparisonRows || [];

  const exportColumns = useMemo(() => {
    const cols = [
      { key: "srNo", label: "Sr. No." },
      { key: "employeeId", label: "Employee ID" },
      { key: "employeeCode", label: "Employee Code" },
      { key: "employeeName", label: "Employee Name" },
      { key: "designation", label: "Designation" },
      { key: "employeeType", label: "Employee Type" },
      { key: "pension", label: "Pension Type" },
    ];
    for (const field of fields) {
      cols.push({ key: `${field.key}_prev`, label: `${field.label} Previous` });
      cols.push({ key: `${field.key}_curr`, label: `${field.label} Current` });
      cols.push({ key: `${field.key}_var`, label: `${field.label} Variation` });
    }
    return cols;
  }, [fields]);

  const exportRows = useMemo(
    () =>
      rows.map((row) => {
        const out = {
          srNo: row.srNo,
          employeeId: row.employeeId,
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          designation: row.designation,
          employeeType: row.employeeType,
          pension: row.pension,
        };
        for (const field of fields) {
          const c = row.components?.[field.key] || {
            previous: 0,
            current: 0,
            variation: 0,
          };
          out[`${field.key}_prev`] = money(c.previous);
          out[`${field.key}_curr`] = money(c.current);
          out[`${field.key}_var`] = signedMoney(c.variation);
        }
        return out;
      }),
    [rows, fields]
  );

  function renderTripleHeaders(groupFields) {
    return groupFields.map((field) => (
      <th key={field.key} colSpan={3} className="ser-comp-group">
        {field.label}
      </th>
    ));
  }

  function renderSubHeaders(groupFields) {
    return groupFields.flatMap((field) => [
      <th key={`${field.key}-p`} className="ser-sub">
        Previous
      </th>,
      <th key={`${field.key}-c`} className="ser-sub">
        Current
      </th>,
      <th key={`${field.key}-v`} className="ser-sub">
        Variation
      </th>,
    ]);
  }

  function renderAmountCells(row, groupFields) {
    return groupFields.flatMap((field) => {
      const c = row.components?.[field.key] || {
        previous: 0,
        current: 0,
        variation: 0,
      };
      return [
        <td key={`${field.key}-p`} className="ser-num">
          {money(c.previous)}
        </td>,
        <td key={`${field.key}-c`} className="ser-num">
          {money(c.current)}
        </td>,
        <td
          key={`${field.key}-v`}
          className={`ser-num ${variationClass(c.variation)}`}
        >
          {signedMoney(c.variation)}
        </td>,
      ];
    });
  }

  function renderTotalCells(groupFields) {
    const totals = report?.fieldTotals || {};
    return groupFields.flatMap((field) => {
      const c = totals[field.key] || { previous: 0, current: 0, variation: 0 };
      return [
        <td key={`${field.key}-p`} className="ser-num">
          {money(c.previous)}
        </td>,
        <td key={`${field.key}-c`} className="ser-num">
          {money(c.current)}
        </td>,
        <td
          key={`${field.key}-v`}
          className={`ser-num ${variationClass(c.variation)}`}
        >
          {signedMoney(c.variation)}
        </td>,
      ];
    });
  }

  return (
    <div className="ser-overlay" role="dialog" aria-modal="true" aria-label="Variation Report">
      <section className="ser-modal ser-modal-wide" id="salary-entry-variation-report">
        <header className="ser-header no-print">
          <h1>VARIATION REPORT</h1>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {loading && <div className="ser-state">Loading salary comparison…</div>}
        {error && <div className="ser-state ser-error">{error}</div>}

        {report && (
          <div className="ser-content">
            <div className="ser-title">
              <h1>Variation Report</h1>
              <p>Employee-wise Previous Month vs Current Month comparison</p>
            </div>

            <dl className="ser-meta">
              <div>
                <dt>Bill Code</dt>
                <dd>{report.billCode || billCode}</dd>
              </div>
              <div>
                <dt>Institute</dt>
                <dd>
                  {report.instituteName || "-"}
                  {report.instituteCode ? ` (${report.instituteCode})` : ""}
                </dd>
              </div>
              <div>
                <dt>Employees</dt>
                <dd>{report.employeeCount ?? rows.length}</dd>
              </div>
              <div>
                <dt>Previous Salary Month</dt>
                <dd>{report.previousSalaryMonth || report.previousLabel || "—"}</dd>
              </div>
              <div>
                <dt>Current Salary Month</dt>
                <dd>
                  {report.currentSalaryMonth ||
                    report.salaryMonth ||
                    salaryMonth ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt>Bill Month</dt>
                <dd>{report.billMonth || billMonth || "—"}</dd>
              </div>
            </dl>

            <div className="ser-toolbar no-print">
              <GridToolbar
                title="Variation Report"
                columns={exportColumns}
                rows={exportRows}
              />
            </div>

            <div className="ser-scroll ser-scroll-tall">
              <table className="ser-table ser-compare">
                <thead>
                  <tr className="ser-group-row">
                    <th rowSpan={2} className="ser-sticky ser-sticky-1">
                      Sr. No.
                    </th>
                    <th rowSpan={2} className="ser-sticky ser-sticky-2">
                      Employee ID
                    </th>
                    <th rowSpan={2} className="ser-sticky ser-sticky-3">
                      Code
                    </th>
                    <th rowSpan={2} className="ser-sticky ser-sticky-4">
                      Employee Name
                    </th>
                    <th rowSpan={2}>Designation</th>
                    <th rowSpan={2}>Type</th>
                    <th rowSpan={2}>Pension</th>
                    {earningFields.length ? (
                      <th colSpan={earningFields.length * 3} className="ser-band-earn">
                        EARNING
                      </th>
                    ) : null}
                    {deductionFields.length ? (
                      <th
                        colSpan={deductionFields.length * 3}
                        className="ser-band-ded"
                      >
                        DEDUCTION
                      </th>
                    ) : null}
                    {totalFields.length ? (
                      <th colSpan={totalFields.length * 3} className="ser-band-tot">
                        TOTAL
                      </th>
                    ) : null}
                  </tr>
                  <tr className="ser-comp-row">
                    {renderTripleHeaders(earningFields)}
                    {renderTripleHeaders(deductionFields)}
                    {renderTripleHeaders(totalFields)}
                  </tr>
                  <tr className="ser-sub-row">
                    <th className="ser-sticky ser-sticky-1" />
                    <th className="ser-sticky ser-sticky-2" />
                    <th className="ser-sticky ser-sticky-3" />
                    <th className="ser-sticky ser-sticky-4" />
                    <th />
                    <th />
                    <th />
                    {renderSubHeaders(earningFields)}
                    {renderSubHeaders(deductionFields)}
                    {renderSubHeaders(totalFields)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7 + fields.length * 3}
                        className="ser-empty"
                      >
                        No salary employees found for this institute.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={`${row.employeeId}-${row.status}`}
                        className={
                          row.status === "NEW"
                            ? "ser-row-new"
                            : row.status === "REMOVED"
                              ? "ser-row-removed"
                              : ""
                        }
                      >
                        <td className="ser-sticky ser-sticky-1">{row.srNo}</td>
                        <td className="ser-sticky ser-sticky-2">
                          {row.employeeId}
                        </td>
                        <td className="ser-sticky ser-sticky-3">
                          {row.employeeCode}
                        </td>
                        <td className="ser-sticky ser-sticky-4 ser-left">
                          {row.employeeName}
                        </td>
                        <td className="ser-left">{row.designation || "-"}</td>
                        <td>{row.employeeType || "-"}</td>
                        <td>{row.pension || "-"}</td>
                        {renderAmountCells(row, earningFields)}
                        {renderAmountCells(row, deductionFields)}
                        {renderAmountCells(row, totalFields)}
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td
                        colSpan={7}
                        className="ser-sticky ser-sticky-1 ser-left"
                      >
                        TOTAL
                      </td>
                      {renderTotalCells(earningFields)}
                      {renderTotalCells(deductionFields)}
                      {renderTotalCells(totalFields)}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            <div className="ser-totals">
              <span>
                Matched{" "}
                <strong>{report.totals?.matchedEmployees || 0}</strong>
              </span>
              <span>
                New <strong>{report.totals?.newEmployees || 0}</strong>
              </span>
              <span>
                Removed <strong>{report.totals?.removedEmployees || 0}</strong>
              </span>
              <span>
                Net Variation{" "}
                <strong className={variationClass(report.totals?.netVariation)}>
                  {signedMoney(report.totals?.netVariation)}
                </strong>
              </span>
            </div>
          </div>
        )}

        <footer className="ser-actions no-print">
          <button
            type="button"
            className="btn btn-print"
            disabled={!report}
            onClick={() => window.print()}
          >
            Print
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
