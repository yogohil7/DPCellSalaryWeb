import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  listDaDifferenceBills,
  createDaDifferenceBill,
  updateDaDifferenceBill,
  getDaDifferenceMonthLock,
  lockDaDifferenceMonth,
} from "../utils/daDifferenceApi";
import { listSalaryBillCodes } from "../utils/salaryBillCodeApi";
import "./daDifference.css";

/*
  Masters -> DA Difference Master.

  Creates the payment bill for a DA arrears period, e.g.
      Payment month      AUG-2026
      Bill Code          AUG-2026-DA-DIFF
      Difference period  JAN-2026 to APR-2026

  The bill code itself comes from Salary Bill Code Master (Category
  "Difference", Type "DA Difference"); this page only links a period to it.
  No DA percentage is entered or stored here — rates always come from
  DA Master, resolved per month by effective date.
*/

const MONTHS = [
  { number: "01", name: "January", short: "JAN" },
  { number: "02", name: "February", short: "FEB" },
  { number: "03", name: "March", short: "MAR" },
  { number: "04", name: "April", short: "APR" },
  { number: "05", name: "May", short: "MAY" },
  { number: "06", name: "June", short: "JUN" },
  { number: "07", name: "July", short: "JUL" },
  { number: "08", name: "August", short: "AUG" },
  { number: "09", name: "September", short: "SEP" },
  { number: "10", name: "October", short: "OCT" },
  { number: "11", name: "November", short: "NOV" },
  { number: "12", name: "December", short: "DEC" },
];

const STATUS_OPTIONS = ["OPEN", "COMPLETED", "LOCKED"];

const EMPTY_FORM = {
  paymentSalaryMonthNumber: "",
  paymentSalaryYear: "",
  fromSalaryMonthNumber: "",
  fromSalaryYear: "",
  toSalaryMonthNumber: "",
  toSalaryYear: "",
  billCode: "",
  description: "",
  status: "OPEN",
};

function shortOf(monthNumber) {
  return MONTHS.find((m) => m.number === monthNumber)?.short || "";
}

function periodLabel(row) {
  const from = `${shortOf(row.fromSalaryMonthNumber)}-${row.fromSalaryYear}`;
  const to = `${shortOf(row.toSalaryMonthNumber)}-${row.toSalaryYear}`;
  return from === to ? from : `${from} to ${to}`;
}

/** Inclusive month count, used to show the user how many months they picked. */
function monthCount(form) {
  const fy = Number(form.fromSalaryYear);
  const fm = Number(form.fromSalaryMonthNumber);
  const ty = Number(form.toSalaryYear);
  const tm = Number(form.toSalaryMonthNumber);
  if (!fy || !fm || !ty || !tm) return 0;
  const span = ty * 12 + (tm - 1) - (fy * 12 + (fm - 1)) + 1;
  return span > 0 ? span : 0;
}

export default function DADifferenceMaster({ onBack, user }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [records, setRecords] = useState([]);
  const [billCodes, setBillCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [monthLock, setMonthLock] = useState(null);
  const [lockMessage, setLockMessage] = useState("");

  const paymentMonthLabel = useMemo(() => {
    if (!form.paymentSalaryMonthNumber || !form.paymentSalaryYear) return "";
    return `${shortOf(form.paymentSalaryMonthNumber)}-${form.paymentSalaryYear}`;
  }, [form.paymentSalaryMonthNumber, form.paymentSalaryYear]);

  const monthIsLocked = Boolean(monthLock?.isLocked);

  /* =====================================================
     LOAD
  ===================================================== */

  const loadRecords = async () => {
    try {
      setLoading(true);
      setError("");
      setRecords(await listDaDifferenceBills());
    } catch (err) {
      setRecords([]);
      setError(err.message || "Unable to load DA Difference bills.");
    } finally {
      setLoading(false);
    }
  };

  /* Only DA Difference bill codes may be selected. */
  const loadBillCodes = async () => {
    try {
      const rows = await listSalaryBillCodes();
      setBillCodes(
        (Array.isArray(rows) ? rows : []).filter(
          (row) => String(row.billType || "").trim() === "DA Difference"
        )
      );
    } catch {
      setBillCodes([]);
    }
  };

  const refreshMonthLock = async (monthNumber, year) => {
    if (!monthNumber || !year || String(year).length !== 4) {
      setMonthLock(null);
      return;
    }
    try {
      const data = await getDaDifferenceMonthLock({
        year,
        monthNumber,
      });
      setMonthLock(data);
    } catch {
      setMonthLock({
        label: `${shortOf(monthNumber)}-${year}`,
        status: "OPEN",
        isLocked: false,
      });
    }
  };

  useEffect(() => {
    loadRecords();
    loadBillCodes();
  }, []);

  useEffect(() => {
    refreshMonthLock(form.paymentSalaryMonthNumber, form.paymentSalaryYear);
  }, [form.paymentSalaryMonthNumber, form.paymentSalaryYear]);

  /* =====================================================
     FORM
  ===================================================== */

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setLockMessage("");
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setLockMessage("");
  };

  const selectedCount = useMemo(() => monthCount(form), [form]);

  const handleLockMonth = async () => {
    if (!form.paymentSalaryMonthNumber || !form.paymentSalaryYear) {
      alert("Please select the Payment Salary Month and Year first.");
      return;
    }
    const label =
      paymentMonthLabel ||
      `${shortOf(form.paymentSalaryMonthNumber)}-${form.paymentSalaryYear}`;
    const confirmed = window.confirm(
      `Are you sure you want to lock DA Difference for ${label}?`
    );
    if (!confirmed) return;

    try {
      setLocking(true);
      setLockMessage("");
      const result = await lockDaDifferenceMonth(
        {
          year: form.paymentSalaryYear,
          monthNumber: form.paymentSalaryMonthNumber,
          paymentSalaryYear: form.paymentSalaryYear,
          paymentSalaryMonthNumber: form.paymentSalaryMonthNumber,
        },
        user
      );
      setMonthLock(result?.data || result);
      setLockMessage(
        result?.message ||
          `DA Difference month ${label} has been locked successfully.`
      );
      await loadRecords();
    } catch (err) {
      alert(err.message || "Unable to lock DA Difference month.");
    } finally {
      setLocking(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (monthIsLocked) {
      alert(
        `DA Difference month ${paymentMonthLabel || "selected"} is locked and cannot be modified.`
      );
      return;
    }

    if (!form.paymentSalaryMonthNumber || !form.paymentSalaryYear) {
      alert("Please select the Payment Salary Month and Year.");
      return;
    }
    if (!form.fromSalaryMonthNumber || !form.fromSalaryYear) {
      alert("Please select the From Salary Month and Year.");
      return;
    }
    if (!form.toSalaryMonthNumber || !form.toSalaryYear) {
      alert("Please select the To Salary Month and Year.");
      return;
    }
    if (selectedCount === 0) {
      alert("The From month must be the same as or earlier than the To month.");
      return;
    }
    if (!editingId && !form.billCode) {
      alert("Please select the DA Difference Bill Code.");
      return;
    }

    try {
      setSaving(true);
      const result = editingId
        ? await updateDaDifferenceBill(editingId, form, user)
        : await createDaDifferenceBill(form, user);

      alert(
        result?.message ||
          (editingId
            ? "DA Difference bill updated successfully."
            : "DA Difference bill created successfully.")
      );
      handleReset();
      await loadRecords();
    } catch (err) {
      alert(err.message || "Unable to save the DA Difference bill.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record) => {
    if (record.monthLocked) {
      alert(
        `DA Difference month ${record.paymentMonthLabel || ""} is locked and cannot be modified.`
      );
    }
    setForm({
      paymentSalaryMonthNumber: record.paymentSalaryMonthNumber || "",
      paymentSalaryYear: record.paymentSalaryYear || "",
      fromSalaryMonthNumber: record.fromSalaryMonthNumber || "",
      fromSalaryYear: record.fromSalaryYear || "",
      toSalaryMonthNumber: record.toSalaryMonthNumber || "",
      toSalaryYear: record.toSalaryYear || "",
      billCode: record.billCode || "",
      description: record.description || "",
      status: record.status || "OPEN",
    });
    setEditingId(record.monthLocked ? null : record.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

      <h1 className="dad-page-title">DA DIFFERENCE MASTER</h1>

      <section className="dad-card">
        <div className="dad-card-head">
          <span>DA DIFFERENCE BILL INFORMATION</span>
          <span className="dad-crumb">
            <Breadcrumb className="dad-crumb" section="Masters" current="DA Difference Master" />
          </span>
        </div>

        <div className="dad-card-body">
          {paymentMonthLabel ? (
            <div className="dad-month-lock-bar">
              <div className="dad-month-lock-meta">
                <span>
                  <strong>DA Difference Month:</strong> {paymentMonthLabel}
                </span>
                <span
                  className={`dad-month-lock-status ${
                    monthIsLocked ? "is-locked" : "is-open"
                  }`}
                >
                  Status: {monthIsLocked ? "LOCKED" : "OPEN"}
                </span>
              </div>
              {monthIsLocked ? (
                <button type="button" className="dad-btn lock locked" disabled>
                  Month Locked
                </button>
              ) : (
                <button
                  type="button"
                  className="dad-btn lock"
                  onClick={handleLockMonth}
                  disabled={locking}
                >
                  {locking ? "Locking..." : "Lock Month"}
                </button>
              )}
            </div>
          ) : (
            <div className="dad-month-lock-bar is-hint">
              Select Payment Salary Month and Year to view lock status (use
              JUN-2026 for testing).
            </div>
          )}

          {lockMessage ? (
            <div className="dad-message is-success" style={{ marginBottom: 12 }}>
              {lockMessage}
            </div>
          ) : null}

          {monthIsLocked ? (
            <div className="dad-message is-warning" style={{ marginBottom: 12 }}>
              DA Difference month {paymentMonthLabel} is locked. Viewing is
              allowed; create/edit/save are disabled.
            </div>
          ) : null}

          <form onSubmit={handleSave}>
            <div className="dad-grid">
              {/* PAYMENT SALARY MONTH */}
              <label>
                <span className="dad-label-text">
                  Payment Salary Month<em>*</em>
                </span>
                <select
                  name="paymentSalaryMonthNumber"
                  value={form.paymentSalaryMonthNumber}
                  onChange={handleChange}
                  required
                  disabled={monthIsLocked && Boolean(editingId)}
                >
                  <option value="">Select Month</option>
                  {MONTHS.map((month) => (
                    <option key={month.number} value={month.number}>
                      {month.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* PAYMENT SALARY YEAR */}
              <label>
                <span className="dad-label-text">
                  Payment Salary Year<em>*</em>
                </span>
                <input
                  type="text"
                  name="paymentSalaryYear"
                  value={form.paymentSalaryYear}
                  onChange={handleChange}
                  placeholder="YYYY"
                  maxLength={4}
                  required
                  disabled={monthIsLocked && Boolean(editingId)}
                />
              </label>

              {/* FROM */}
              <label>
                <span className="dad-label-text">
                  From Salary Month<em>*</em>
                </span>
                <select
                  name="fromSalaryMonthNumber"
                  value={form.fromSalaryMonthNumber}
                  onChange={handleChange}
                  required
                  disabled={monthIsLocked}
                >
                  <option value="">Select Month</option>
                  {MONTHS.map((month) => (
                    <option key={month.number} value={month.number}>
                      {month.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="dad-label-text">
                  From Salary Year<em>*</em>
                </span>
                <input
                  type="text"
                  name="fromSalaryYear"
                  value={form.fromSalaryYear}
                  onChange={handleChange}
                  placeholder="YYYY"
                  maxLength={4}
                  required
                  disabled={monthIsLocked}
                />
              </label>

              {/* TO */}
              <label>
                <span className="dad-label-text">
                  To Salary Month<em>*</em>
                </span>
                <select
                  name="toSalaryMonthNumber"
                  value={form.toSalaryMonthNumber}
                  onChange={handleChange}
                  required
                  disabled={monthIsLocked}
                >
                  <option value="">Select Month</option>
                  {MONTHS.map((month) => (
                    <option key={month.number} value={month.number}>
                      {month.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="dad-label-text">
                  To Salary Year<em>*</em>
                </span>
                <input
                  type="text"
                  name="toSalaryYear"
                  value={form.toSalaryYear}
                  onChange={handleChange}
                  placeholder="YYYY"
                  maxLength={4}
                  required
                  disabled={monthIsLocked}
                />
              </label>

              {/* BILL CODE */}
              <label>
                <span className="dad-label-text">
                  DA Difference Bill Code<em>*</em>
                </span>
                <select
                  name="billCode"
                  value={form.billCode}
                  onChange={handleChange}
                  disabled={Boolean(editingId) || monthIsLocked}
                  required={!editingId}
                >
                  <option value="">Select Bill Code</option>
                  {billCodes.map((row) => (
                    <option key={row.billCode} value={row.billCode}>
                      {row.billCode} ({row.status})
                    </option>
                  ))}
                </select>
              </label>

              {/* STATUS */}
              <label>
                <span className="dad-label-text">
                  Status<em>*</em>
                </span>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  disabled={monthIsLocked}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              {/* DESCRIPTION */}
              <label className="dad-description">
                <span className="dad-label-text">Description</span>
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Enter Description"
                  disabled={monthIsLocked}
                />
              </label>
            </div>

            {selectedCount > 0 ? (
              <div className="dad-period-bar" style={{ marginTop: 14 }}>
                <span>
                  <strong>Difference period:</strong>{" "}
                  {shortOf(form.fromSalaryMonthNumber)}-{form.fromSalaryYear} to{" "}
                  {shortOf(form.toSalaryMonthNumber)}-{form.toSalaryYear}
                </span>
                <span className="dad-period-chip">
                  {selectedCount} month{selectedCount === 1 ? "" : "s"}
                </span>
                <span>
                  DA rates are read from DA Master for each month separately.
                </span>
              </div>
            ) : null}

            {billCodes.length === 0 ? (
              <div className="dad-message is-warning" style={{ marginTop: 14 }}>
                No DA Difference bill codes exist yet. Create one in Salary Bill
                Code Master with Category &quot;Difference&quot; and Type
                &quot;DA Difference&quot; — for example JUN-2026-DA-DIFF.
              </div>
            ) : null}

            <div className="dad-actions">
              <button
                type="submit"
                className="dad-btn primary"
                disabled={saving || monthIsLocked}
              >
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
              <button
                type="button"
                className="dad-btn reset"
                onClick={handleReset}
                disabled={saving}
              >
                Reset
              </button>
              <button type="button" className="dad-btn cancel" onClick={onBack}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="dad-card">
        <div className="dad-card-head">
          <span>DA DIFFERENCE BILL LIST</span>
        </div>

        <div className="dad-card-body">
          {error ? <div className="dad-message is-error">{error}</div> : null}

          {loading ? (
            <div className="dad-loading">Loading DA Difference bills...</div>
          ) : (
            <DataGrid
              title="DA Difference Bills"
              rows={records}
              emptyText="No DA Difference bills found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                { key: "billCode", label: "Bill Code" },
                {
                  key: "paymentPeriod",
                  label: "Payment Month",
                  getValue: (row) =>
                    `${shortOf(row.paymentSalaryMonthNumber)}-${row.paymentSalaryYear}`,
                  render: (row) =>
                    `${shortOf(row.paymentSalaryMonthNumber)}-${row.paymentSalaryYear}`,
                },
                {
                  key: "period",
                  label: "Difference Period",
                  getValue: periodLabel,
                  render: periodLabel,
                },
                {
                  key: "months",
                  label: "Months",
                  type: "number",
                  getValue: (row) => String(monthCount(row)),
                  render: (row) => monthCount(row),
                },
                { key: "description", label: "Description", align: "left" },
                { key: "status", label: "Status", type: "status" },
                {
                  key: "monthLockStatus",
                  label: "Month Lock",
                  getValue: (row) =>
                    row.monthLocked || row.monthLockStatus === "LOCKED"
                      ? "LOCKED"
                      : "OPEN",
                  render: (row) =>
                    row.monthLocked || row.monthLockStatus === "LOCKED"
                      ? "LOCKED"
                      : "OPEN",
                },
                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,
                  render: (record) =>
                    record.monthLocked ? (
                      <span className="dad-month-lock-status is-locked">
                        Month Locked
                      </span>
                    ) : (
                      <GridActions onEdit={() => handleEdit(record)} />
                    ),
                },
              ]}
            />
          )}
        </div>
      </section>
    </div>
  );
}
