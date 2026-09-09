import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid from "../components/DataGrid";
import {
  listDaDifferenceBills,
  calculateDaDifference,
  saveDaDifference,
  submitDaDifference,
  getDaDifferenceDetail,
} from "../utils/daDifferenceApi";
import { listInstitutes } from "../utils/instituteApi";
import "./daDifference.css";

/*
  Salary -> DA Difference Entry.

  Select a DA Difference bill and an institute, then Calculate. The grid
  shows one column group per month of the period, so a JAN..APR bill shows
  four groups and a JAN..JUN bill shows six.

  Every amount is calculated by SQL Server from the historical salary
  snapshot of each month. Nothing is computed in the browser and nothing is
  cached in localStorage. Once saved, the stored snapshot is read back
  as-is — a later DA Master change never alters a saved bill.
*/

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "DRAFT") return "is-draft";
  if (s === "SUBMITTED" || s === "RESUBMITTED" || s === "VERIFIED") return "is-submitted";
  if (s === "RETURNED" || s === "REJECTED") return "is-returned";
  if (s === "APPROVED") return "is-approved";
  if (s === "LOCKED") return "is-locked";
  return "";
}

/* A saved bill in these states must not be recalculated or overwritten. */
const READ_ONLY_STATUSES = new Set([
  "SUBMITTED",
  "RESUBMITTED",
  "VERIFIED",
  "APPROVED",
  "LOCKED",
]);

export default function DADifferenceEntry({ onBack, user }) {
  const [bills, setBills] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [billId, setBillId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");

  const [months, setMonths] = useState([]);
  const [rows, setRows] = useState([]);
  /* employeeId|YYYY-MM -> NPS the user typed in this session. */
  const [npsEdits, setNpsEdits] = useState({});
  const [viewMode, setViewMode] = useState("month");
  const [grandTotal, setGrandTotal] = useState(0);
  const [workflowStatus, setWorkflowStatus] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  const selectedBill = useMemo(
    () => bills.find((row) => String(row.id) === String(billId)) || null,
    [bills, billId]
  );

  const readOnly =
    READ_ONLY_STATUSES.has(String(workflowStatus || "").toUpperCase()) ||
    Boolean(selectedBill?.monthLocked);

  /* =====================================================
     LOAD LOOKUPS
  ===================================================== */

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [billRows, instituteRows] = await Promise.all([
          listDaDifferenceBills(),
          listInstitutes(),
        ]);
        if (!active) return;

        setBills(billRows);

        const mapped = (Array.isArray(instituteRows) ? instituteRows : [])
          .map((row) => ({
            id: row.instituteId ?? row.id,
            code: row.instituteCode || row.code || "",
            name: row.instituteName || row.name || "",
          }))
          .filter((row) => row.code);
        setInstitutes(mapped);

        if (billRows.length === 0) {
          setError(
            "No DA Difference bills found. Create one in Masters → DA Difference Master."
          );
        }
      } catch (err) {
        if (active) setError(err.message || "Unable to load DA Difference bills.");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /* Selecting a bill/institute clears the grid until the user acts. */
  useEffect(() => {
    setRows([]);
    setMonths([]);
    setNpsEdits({});
    setGrandTotal(0);
    setWorkflowStatus("");
    setIsSaved(false);
    setMessage("");
    setWarnings([]);
  }, [billId, instituteCode]);

  /* =====================================================
     ACTIONS
  ===================================================== */

  function requireSelection() {
    if (!billId) {
      alert("Please select a DA Difference Bill Code.");
      return false;
    }
    if (!instituteCode) {
      alert("Please select an Institute.");
      return false;
    }
    return true;
  }

  /*
    Bill header fields. These live on the SAME institute workflow row Salary
    Entry uses (BillNo / BillDate / NPSScheduleNo), so there is no second
    bill-number system. Bill Date is the date on the document — distinct from
    Payment Month, Salary Month and Bill Month.
  */
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [npsScheduleNo, setNpsScheduleNo] = useState("");

  const applyResult = (result, saved) => {
    setMonths(Array.isArray(result?.months) ? result.months : []);
    setRows(Array.isArray(result?.data) ? result.data : []);
    /* The server response already carries any saved manual NPS, so local
       edits are dropped rather than replayed over it. */
    setNpsEdits({});
    setGrandTotal(Number(result?.grandTotal) || 0);
    setWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
    setIsSaved(Boolean(saved));
    if (result?.workflowStatus) setWorkflowStatus(result.workflowStatus);
    /* Restore exactly what was stored; a bill's saved date is never
       silently replaced on open. */
    if (result?.billNo !== undefined) setBillNo(result.billNo || "");
    if (result?.billDate !== undefined) {
      setBillDate(result.billDate ? String(result.billDate).slice(0, 10) : "");
    }
    if (result?.npsScheduleNo !== undefined) {
      setNpsScheduleNo(result.npsScheduleNo || "");
    }
  };

  /* Load the SAVED snapshot — never recalculated. */
  const handleLoadSaved = async () => {
    if (!requireSelection()) return;
    try {
      setLoading(true);
      setError("");
      const result = await getDaDifferenceDetail(billId, { instituteCode });
      applyResult(result, result?.saved);
      setMessage(
        result?.saved
          ? `Loaded the saved snapshot for ${instituteCode}. These are the stored amounts, not a recalculation.`
          : `Nothing saved yet for ${instituteCode}. Click Calculate to build it.`
      );
    } catch (err) {
      setError(err.message || "Unable to load the saved DA Difference.");
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    if (!requireSelection()) return;
    try {
      setLoading(true);
      setError("");
      const result = await calculateDaDifference(
        billId,
        { instituteCode, npsOverrides: buildNpsOverrides() },
        user
      );
      applyResult(result, false);
      setMessage(
        result?.data?.length
          ? `Calculated ${result.data.length} employee(s) across ${result.months?.length || 0} month(s). Nothing is saved yet.`
          : result?.message || "No employees found for this period."
      );
    } catch (err) {
      setError(err.message || "Unable to calculate DA Difference.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!requireSelection()) return;
    if (readOnly) {
      alert(
        selectedBill?.monthLocked
          ? `DA Difference month ${selectedBill.paymentMonthLabel || ""} is locked and cannot be modified.`
          : `This bill is ${workflowStatus} and cannot be modified.`
      );
      return;
    }
    if (invalidNpsRows.length) {
      alert(
        `${invalidNpsRows.length} NPS value(s) are invalid. NPS must be a ` +
          `number, cannot be negative, and cannot exceed its own DA Difference.`
      );
      return;
    }
    try {
      setBusy(true);
      const result = await saveDaDifference(
        billId,
        {
          instituteCode,
          npsOverrides: buildNpsOverrides(),
          billNo,
          billDate,
          npsScheduleNo,
        },
        user
      );
      applyResult(result, true);
      setWorkflowStatus(result?.status || "DRAFT");
      alert(result?.message || "DA Difference snapshot saved.");
    } catch (err) {
      alert(err.message || "Unable to save DA Difference.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!requireSelection()) return;
    if (readOnly) {
      alert(
        selectedBill?.monthLocked
          ? `DA Difference month ${selectedBill.paymentMonthLabel || ""} is locked and cannot be modified.`
          : `This bill is ${workflowStatus} and cannot be modified.`
      );
      return;
    }
    if (
      !window.confirm(
        `Submit the DA Difference bill for ${instituteCode}? The saved amounts become the payment snapshot.`
      )
    ) {
      return;
    }
    if (invalidNpsRows.length) {
      alert(
        `${invalidNpsRows.length} NPS value(s) are invalid. NPS must be a ` +
          `number, cannot be negative, and cannot exceed its own DA Difference.`
      );
      return;
    }
    if (!billNo.trim() || !billDate) {
      alert("Bill Number and Bill Date are required before submitting.");
      return;
    }
    try {
      setBusy(true);
      const result = await submitDaDifference(
        billId,
        {
          instituteCode,
          npsOverrides: buildNpsOverrides(),
          billNo,
          billDate,
          npsScheduleNo,
        },
        user
      );
      applyResult(result, true);
      setWorkflowStatus(result?.status || "SUBMITTED");
      alert(result?.message || "DA Difference bill submitted.");
    } catch (err) {
      alert(err.message || "Unable to submit DA Difference.");
    } finally {
      setBusy(false);
    }
  };

  /* =====================================================
     MONTH-WISE ROWS + EDITABLE NPS

     One row per employee per month, which is what makes an inline NPS
     editor practical. DA Difference is read-only (calculated by SQL
     Server); Net = DA Difference - NPS Deduction and follows every
     keystroke.
  ===================================================== */

  const npsKeyOf = (employeeId, month) =>
    `${employeeId}|${month.salaryYear}-${month.salaryMonthNumber}`;

  const flatRows = useMemo(() => {
    const out = [];
    rows.forEach((employee) => {
      (employee.months || []).forEach((month) => {
        const key = npsKeyOf(employee.employeeId, month);
        const edited = npsEdits[key];
        const difference = Number(month.differenceAmount) || 0;

        /* An in-progress edit wins over the stored value, so typing is
           never fought by a recalculation. */
        const npsValue =
          edited !== undefined
            ? edited
            : String(Number(month.npsDeduction) || 0);

        const npsNumber = Number(npsValue);
        const npsValid = npsValue !== "" && Number.isFinite(npsNumber) && npsNumber >= 0;

        out.push({
          key,
          employeeId: employee.employeeId,
          employeeCode: employee.employeeCode || "",
          employeeName: employee.employeeName || "",
          designation: employee.designation || "",
          salaryMonth: month.salaryMonth,
          salaryYear: month.salaryYear,
          salaryMonthNumber: month.salaryMonthNumber,
          /* Which salary bill this month's figures came from, for the tooltip. */
          sourceBillCode: month.sourceBillCode || "",
          sourceBillMonth: month.sourceBillMonth || "",
          historicalBasic: Number(month.historicalBasic) || 0,
          oldDARate: month.oldDARate,
          oldDA: Number(month.oldDA) || 0,
          revisedDARate: Number(month.revisedDARate) || 0,
          revisedDA: Number(month.revisedDA) || 0,
          differenceAmount: difference,
          npsRaw: npsValue,
          npsDeduction: npsValid ? npsNumber : 0,
          npsValid,
          npsManual: edited !== undefined || Boolean(month.npsManual),
          netDifferenceAmount: npsValid
            ? Number((difference - npsNumber).toFixed(2))
            : difference,
          snapshotMissing: Boolean(month.snapshotMissing),
        });
      });
    });
    return out;
  }, [rows, npsEdits]);

  const handleNpsChange = (row, value) => {
    setNpsEdits((prev) => ({ ...prev, [row.key]: value }));
  };

  const invalidNpsRows = useMemo(
    () =>
      flatRows.filter(
        (row) =>
          !row.npsValid || row.npsDeduction > row.differenceAmount + 0.001
      ),
    [flatRows]
  );

  /* Totals recomputed from the flat rows, so they move as NPS is edited. */
  const totals = useMemo(() => {
    let difference = 0;
    let nps = 0;
    let net = 0;
    flatRows.forEach((row) => {
      difference += row.differenceAmount;
      nps += row.npsDeduction;
      net += row.netDifferenceAmount;
    });
    return {
      difference: Number(difference.toFixed(2)),
      nps: Number(nps.toFixed(2)),
      net: Number(net.toFixed(2)),
    };
  }, [flatRows]);

  /* Only edited values are sent; the server revalidates and recomputes
     every other amount itself. */
  const buildNpsOverrides = () =>
    flatRows
      .filter((row) => npsEdits[row.key] !== undefined)
      .map((row) => ({
        employeeId: row.employeeId,
        salaryYear: row.salaryYear,
        salaryMonthNumber: row.salaryMonthNumber,
        npsDeduction: row.npsDeduction,
      }));

  const monthColumns = useMemo(
    () => [
      { key: "sr", label: "Sr. No.", type: "serial" },
      {
        key: "employeeCode",
        label: "Employee Code",
        getValue: (row) => String(row.employeeCode || ""),
      },
      { key: "employeeName", label: "Employee Name", align: "left" },
      {
        key: "salaryMonth",
        label: "Month",
        /*
           Same column, same width, same text. Hovering shows which salary
           bill supplied the month, so a Bill-Month variant such as
           JUN-2026-BM-MAY is visible without changing the layout.
        */
        getValue: (row) => String(row.salaryMonth || ""),
        render: (row) => (
          <span
            title={
              row.sourceBillCode
                ? `Source bill: ${row.sourceBillCode}` +
                  (row.sourceBillMonth
                    ? ` (Bill Month ${row.sourceBillMonth})`
                    : "")
                : "No salary bill found for this Bill Month"
            }
          >
            {row.salaryMonth}
          </span>
        ),
      },
      {
        key: "historicalBasic",
        label: "Basic",
        type: "number",
        getValue: (row) => money(row.historicalBasic),
        render: (row) =>
          row.snapshotMissing ? (
            <span className="dad-missing">no snapshot</span>
          ) : (
            money(row.historicalBasic)
          ),
      },
      {
        key: "oldDA",
        label: "Old DA",
        type: "number",
        getValue: (row) => money(row.oldDA),
        render: (row) => money(row.oldDA),
      },
      {
        key: "oldDARate",
        label: "Old DA Rate",
        type: "number",
        getValue: (row) => (row.oldDARate == null ? "" : `${row.oldDARate}%`),
        render: (row) => (row.oldDARate == null ? "—" : `${row.oldDARate}%`),
      },
      {
        key: "revisedDARate",
        label: "Revised DA Rate",
        type: "number",
        getValue: (row) => `${row.revisedDARate}%`,
        render: (row) => `${row.revisedDARate}%`,
      },
      {
        key: "revisedDA",
        label: "Revised DA",
        type: "number",
        getValue: (row) => money(row.revisedDA),
        render: (row) => money(row.revisedDA),
      },
      {
        key: "differenceAmount",
        label: "DA Difference",
        type: "number",
        getValue: (row) => money(row.differenceAmount),
        render: (row) => money(row.differenceAmount),
      },
      {
        key: "npsDeduction",
        label: "NPS Deduction",
        type: "number",
        sortable: false,
        getValue: (row) => money(row.npsDeduction),
        render: (row) => (
          <input
            type="number"
            className={`dad-nps-input ${row.npsValid ? "" : "is-invalid"} ${
              row.npsManual ? "is-manual" : ""
            }`}
            value={row.npsRaw}
            min="0"
            step="0.01"
            max={row.differenceAmount}
            disabled={readOnly || row.snapshotMissing}
            onChange={(event) => handleNpsChange(row, event.target.value)}
            title={
              row.npsManual
                ? "Manually entered — this value is saved as typed."
                : "Default: CEILING(DA Difference x 10%, 1)"
            }
          />
        ),
      },
      {
        key: "netDifferenceAmount",
        label: "Net DA Difference",
        type: "number",
        getValue: (row) => money(row.netDifferenceAmount),
        render: (row) => <strong>{money(row.netDifferenceAmount)}</strong>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly]
  );

  const monthFooterTotals = useMemo(
    () =>
      flatRows.length
        ? {
            differenceAmount: money(totals.difference),
            npsDeduction: money(totals.nps),
            netDifferenceAmount: money(totals.net),
          }
        : null,
    [flatRows, totals]
  );

  /* =====================================================
     DYNAMIC COLUMNS — one group per month of the period
  ===================================================== */

  const { columns, headerGroups } = useMemo(() => {
    const monthValue = (row, index, field) => {
      const month = row.months?.[index];
      return month ? Number(month[field]) || 0 : 0;
    };

    /* DataGrid searches and sorts on the TEXT a column yields, so every
       getValue must return a string. Commas are stripped before numeric
       sorting, so a formatted amount still sorts correctly. */
    const monthText = (row, index, field) => money(monthValue(row, index, field));

    const base = [
      { key: "sr", label: "Sr. No.", type: "serial" },
      {
        key: "employeeId",
        label: "Employee ID",
        type: "number",
        getValue: (row) => String(row.employeeId ?? ""),
      },
      { key: "employeeName", label: "Employee Name", align: "left" },
      { key: "designation", label: "Designation", align: "left" },
      {
        key: "instituteCode",
        label: "Institute",
        getValue: (row) => row.instituteCode || instituteCode,
        render: (row) => row.instituteCode || instituteCode,
      },
    ];

    const groups = [
      {
        label: "Employee",
        keys: base.map((column) => column.key),
        includeSerial: true,
      },
    ];

    months.forEach((month, index) => {
      const short = month.label || month.key;
      const keys = [
        `m${index}_basic`,
        `m${index}_oldDA`,
        `m${index}_revisedDA`,
        `m${index}_difference`,
      ];

      base.push(
        {
          key: keys[0],
          label: `${short} Basic`,
          type: "number",
          getValue: (row) => monthText(row, index, "historicalBasic"),
          render: (row) => {
            const month_ = row.months?.[index];
            if (month_?.snapshotMissing) {
              return <span className="dad-missing">no snapshot</span>;
            }
            return money(monthValue(row, index, "historicalBasic"));
          },
        },
        {
          key: keys[1],
          label: `${short} Old DA`,
          type: "number",
          getValue: (row) => monthText(row, index, "oldDA"),
          render: (row) => money(monthValue(row, index, "oldDA")),
        },
        {
          key: keys[2],
          label: `${short} Revised DA`,
          type: "number",
          getValue: (row) => monthText(row, index, "revisedDA"),
          render: (row) => money(monthValue(row, index, "revisedDA")),
        },
        {
          key: keys[3],
          label: `${short} DA Difference`,
          type: "number",
          getValue: (row) => monthText(row, index, "differenceAmount"),
          render: (row) => money(monthValue(row, index, "differenceAmount")),
        }
      );

      groups.push({
        label:
          month.revisedDARate != null
            ? `${short} (revised ${month.revisedDARate}%)`
            : short,
        keys,
        className: "dad-month-group",
      });
    });

    base.push({
      key: "totalDifferenceAmount",
      label: "Total DA Difference",
      type: "number",
      getValue: (row) => money(row.totalDifferenceAmount),
      render: (row) => <strong>{money(row.totalDifferenceAmount)}</strong>,
    });

    groups.push({
      label: "Total",
      keys: ["totalDifferenceAmount"],
      className: "dad-total-group",
    });

    return { columns: base, headerGroups: groups };
  }, [months, instituteCode]);

  /* Column totals across every employee. */
  const footerTotals = useMemo(() => {
    if (rows.length === 0) return null;
    const totals = { totalDifferenceAmount: money(grandTotal) };
    months.forEach((_, index) => {
      const sum = rows.reduce(
        (acc, row) => acc + (Number(row.months?.[index]?.differenceAmount) || 0),
        0
      );
      totals[`m${index}_difference`] = money(sum);
    });
    return totals;
  }, [rows, months, grandTotal]);

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="dad-master">
      <div className="dad-back">
        <button type="button" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      <h1 className="dad-page-title">DA DIFFERENCE ENTRY</h1>

      <section className="dad-card">
        <div className="dad-card-head">
          <span>DA DIFFERENCE BILL SELECTION</span>
          <Breadcrumb className="dad-crumb" section="Salary" current="DA Difference Entry" />
        </div>

        <div className="dad-card-body">
          <div className="dad-entry-grid">
            <label>
              <span className="dad-label-text">
                DA Difference Bill Code<em>*</em>
              </span>
              <select
                value={billId}
                onChange={(event) => setBillId(event.target.value)}
              >
                <option value="">Select Bill Code</option>
                {bills.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.billCode} ({row.status})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="dad-label-text">
                Institute<em>*</em>
              </span>
              <select
                value={instituteCode}
                onChange={(event) => setInstituteCode(event.target.value)}
              >
                <option value="">Select Institute</option>
                {institutes.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.code} — {row.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="dad-label-text">Payment Month</span>
              <input
                type="text"
                value={
                  selectedBill
                    ? `${selectedBill.paymentSalaryMonth || ""} ${selectedBill.paymentSalaryYear || ""}`.trim()
                    : ""
                }
                readOnly
              />
            </label>

            <label>
              <span className="dad-label-text">
                Bill Number<em>*</em>
              </span>
              <input
                type="text"
                value={billNo}
                onChange={(event) => setBillNo(event.target.value)}
                placeholder="Bill No."
                readOnly={readOnly}
              />
            </label>

            <label>
              <span className="dad-label-text">
                Bill Date<em>*</em>
              </span>
              <input
                type="date"
                value={billDate}
                onChange={(event) => setBillDate(event.target.value)}
                readOnly={readOnly}
              />
            </label>

            <label>
              <span className="dad-label-text">NPS Schedule No.</span>
              <input
                type="text"
                value={npsScheduleNo}
                onChange={(event) => setNpsScheduleNo(event.target.value)}
                placeholder="NPS Schedule No."
                readOnly={readOnly}
              />
            </label>

            <label>
              <span className="dad-label-text">Difference Period</span>
              <input
                type="text"
                value={
                  selectedBill
                    ? `${selectedBill.fromSalaryMonth} ${selectedBill.fromSalaryYear} to ${selectedBill.toSalaryMonth} ${selectedBill.toSalaryYear}`
                    : ""
                }
                readOnly
              />
            </label>
          </div>

          <div className="dad-actions">
            <button
              type="button"
              className="dad-btn primary"
              onClick={handleCalculate}
              disabled={loading || busy}
            >
              {loading ? "Calculating..." : "Calculate"}
            </button>
            <button
              type="button"
              className="dad-btn cancel"
              onClick={handleLoadSaved}
              disabled={loading || busy}
            >
              Load Saved
            </button>
            <button
              type="button"
              className="dad-btn reset"
              onClick={handleSave}
              disabled={loading || busy || rows.length === 0 || readOnly}
            >
              {busy ? "Saving..." : "Save Draft"}
            </button>
            <button
              type="button"
              className="dad-btn primary"
              onClick={handleSubmit}
              disabled={loading || busy || rows.length === 0 || readOnly}
            >
              Submit
            </button>
          </div>
        </div>
      </section>

      <section className="dad-card">
        <div className="dad-card-head">
          <span>DA DIFFERENCE DETAIL</span>
          {workflowStatus ? (
            <span className={`dad-status-pill ${statusClass(workflowStatus)}`}>
              {workflowStatus}
            </span>
          ) : null}
        </div>

        <div className="dad-card-body">
          {error ? <div className="dad-message is-error">{error}</div> : null}

          {selectedBill?.monthLocked ? (
            <div className="dad-message is-warning">
              DA Difference month {selectedBill.paymentMonthLabel} is locked.
              Viewing is allowed; save/submit are disabled.
            </div>
          ) : null}

          {warnings.map((warning) => (
            <div className="dad-message is-warning" key={warning}>
              {warning}
            </div>
          ))}

          {months.length > 0 ? (
            <div className="dad-period-bar">
              <span>
                <strong>Period:</strong> {months[0].label} to{" "}
                {months[months.length - 1].label}
              </span>
              <span className="dad-period-chip">{months.length} months</span>
              <span>
                <strong>Institute:</strong> {instituteCode}
              </span>
              <span>
                <strong>Total DA Difference:</strong> {money(totals.difference)}
              </span>
              <span>
                <strong>Total NPS:</strong> {money(totals.nps)}
              </span>
              <span>
                <strong>Total Net:</strong> {money(totals.net)}
              </span>
              <span className="dad-period-chip">
                {isSaved ? "Saved snapshot" : "Preview — not saved"}
              </span>
              <button
                type="button"
                className="dad-btn cancel"
                style={{ height: 26, padding: "0 10px" }}
                onClick={() =>
                  setViewMode((mode) => (mode === "month" ? "summary" : "month"))
                }
              >
                {viewMode === "month"
                  ? "Employee summary view"
                  : "Month-wise view"}
              </button>
            </div>
          ) : null}

          {message ? <div className="dad-message">{message}</div> : null}

          {invalidNpsRows.length ? (
            <div className="dad-message is-error">
              {invalidNpsRows.length} NPS value(s) are invalid. NPS must be
              numeric, may be zero, cannot be negative, and cannot exceed its
              own DA Difference.
            </div>
          ) : null}

          {loading ? (
            <div className="dad-loading">Loading DA Difference detail...</div>
          ) : viewMode === "month" ? (
            <DataGrid
              title={`DA Difference ${selectedBill?.billCode || ""}`}
              rows={flatRows}
              rowKey="key"
              emptyText="Select a bill code and institute, then click Calculate."
              columns={monthColumns}
              footerTotals={monthFooterTotals}
              defaultPageSize={25}
            />
          ) : (
            <DataGrid
              title={`DA Difference summary ${selectedBill?.billCode || ""}`}
              rows={rows}
              rowKey="employeeId"
              emptyText="Select a bill code and institute, then click Calculate."
              columns={columns}
              headerGroups={headerGroups}
              footerTotals={footerTotals}
              defaultPageSize={25}
            />
          )}
        </div>
      </section>
    </div>
  );
}
