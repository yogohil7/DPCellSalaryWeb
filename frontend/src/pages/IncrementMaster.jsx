import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  listIncrements,
  calculateIncrement,
  createIncrement,
  updateIncrement,
  cancelIncrement,
} from "../utils/employeeIncrementApi";
import { listEmployees } from "../utils/employeeApi";
import { listInstitutes } from "../utils/instituteApi";
import { sortInstitutesByCode } from "../utils/instituteCodeSort";
import "./incrementMaster.css";

/*
  Masters -> Increment Master.

  Each employee has their own increment month, taken from Employee Master
  (Increment Date, or Month of Increment). Nothing here is hard-coded to
  July: the effective month is whatever the employee's own date says.

  Calculate previews the increment for a chosen salary month — it reads the
  next Pay Matrix cell from SQL Server and writes nothing. Save records it
  in EmployeeIncrement, which is append-only history.
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

const EMPTY_FORM = {
  employeeId: "",
  salaryMonthNumber: "",
  salaryYear: "",
  incrementAmount: "",
  newBasic: "",
  remarks: "",
};

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

export default function IncrementMaster({ onBack, user }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [filterInstitute, setFilterInstitute] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  /* =====================================================
     LOAD
  ===================================================== */

  const loadRecords = async () => {
    try {
      setLoading(true);
      setError("");
      setRecords(
        await listIncrements({
          employeeId: filterEmployee || undefined,
          instituteCode: filterInstitute || undefined,
        })
      );
    } catch (err) {
      setRecords([]);
      setError(err.message || "Unable to load increments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [employeeRows, instituteRows] = await Promise.all([
          listEmployees(),
          listInstitutes(),
        ]);
        setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
        /* Natural InstituteCode presentation order (never InstituteId). */
        setInstitutes(
          sortInstitutesByCode(
            (Array.isArray(instituteRows) ? instituteRows : [])
              .map((row) => ({
                code: row.instituteCode || row.code || "",
                name: row.instituteName || row.name || "",
              }))
              .filter((row) => row.code)
          )
        );
      } catch {
        setEmployees([]);
        setInstitutes([]);
      }
    })();
  }, []);

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmployee, filterInstitute]);

  /* =====================================================
     FORM
  ===================================================== */

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name !== "remarks") setPreview(null);
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setPreview(null);
  };

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (row) => String(row.employeeId ?? row.id) === String(form.employeeId)
      ) || null,
    [employees, form.employeeId]
  );

  function requireForm() {
    if (!form.employeeId) {
      alert("Please select an Employee.");
      return false;
    }
    if (!form.salaryMonthNumber || !form.salaryYear) {
      alert("Please select the Salary Month and Year the increment takes effect in.");
      return false;
    }
    return true;
  }

  /* Preview only — the backend writes nothing for this call. */
  const handleCalculate = async () => {
    if (!requireForm()) return;
    try {
      setSaving(true);
      const result = await calculateIncrement(form, user);
      setPreview(result?.data || null);
      if (result?.data && !result.data.due) {
        alert(
          result.data.reason ||
            "No increment is due for this employee in the selected month."
        );
      }
    } catch (err) {
      setPreview(null);
      alert(err.message || "Unable to calculate the increment.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!requireForm()) return;

    try {
      setSaving(true);
      const result = editingId
        ? await updateIncrement(editingId, form, user)
        : await createIncrement(form, user);
      alert(result?.message || "Increment saved successfully.");
      handleReset();
      await loadRecords();
    } catch (err) {
      alert(err.message || "Unable to save the increment.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record) => {
    const [year, month] = String(record.effectiveMonth || "").split("-");
    setForm({
      employeeId: String(record.employeeId),
      salaryMonthNumber: month || "",
      salaryYear: year || "",
      incrementAmount: String(record.incrementAmount ?? ""),
      newBasic: String(record.newBasic ?? ""),
      remarks: record.remarks || "",
    });
    setEditingId(record.id);
    setPreview(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelIncrement = async (record) => {
    if (
      !window.confirm(
        `Cancel the increment for ${record.employeeName} effective ${record.effectiveMonth}? The history record is kept.`
      )
    ) {
      return;
    }
    try {
      const result = await cancelIncrement(record.id, user);
      alert(result?.message || "Increment cancelled.");
      await loadRecords();
    } catch (err) {
      alert(err.message || "Unable to cancel the increment.");
    }
  };

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="inc-master">
      <div className="inc-back">
        <button type="button" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      <h1 className="inc-page-title">INCREMENT MASTER</h1>

      <section className="inc-card">
        <div className="inc-card-head">
          <span>EMPLOYEE INCREMENT INFORMATION</span>
          <Breadcrumb className="inc-crumb" section="Masters" current="Increment Master" />
        </div>

        <div className="inc-card-body">
          <form onSubmit={handleSave}>
            <div className="inc-grid">
              <label>
                <span className="inc-label-text">
                  Employee<em>*</em>
                </span>
                <select
                  name="employeeId"
                  value={form.employeeId}
                  onChange={handleChange}
                  disabled={Boolean(editingId)}
                  required
                >
                  <option value="">Select Employee</option>
                  {employees.map((row) => {
                    const id = row.employeeId ?? row.id;
                    return (
                      <option key={id} value={id}>
                        {row.employeeCode ? `${row.employeeCode} — ` : ""}
                        {row.employeeName || row.name}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label>
                <span className="inc-label-text">
                  Effective Salary Month<em>*</em>
                </span>
                <select
                  name="salaryMonthNumber"
                  value={form.salaryMonthNumber}
                  onChange={handleChange}
                  required
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
                <span className="inc-label-text">
                  Effective Salary Year<em>*</em>
                </span>
                <input
                  type="text"
                  name="salaryYear"
                  value={form.salaryYear}
                  onChange={handleChange}
                  placeholder="YYYY"
                  maxLength={4}
                  required
                />
              </label>

              <label>
                <span className="inc-label-text">Increment Amount</span>
                <input
                  type="number"
                  name="incrementAmount"
                  value={form.incrementAmount}
                  onChange={handleChange}
                  placeholder="Leave blank to use the Pay Matrix"
                  min="0"
                  step="0.01"
                />
              </label>

              <label>
                <span className="inc-label-text">Manual New Basic</span>
                <input
                  type="number"
                  name="newBasic"
                  value={form.newBasic}
                  onChange={handleChange}
                  placeholder="Overrides the Pay Matrix cell"
                  min="0"
                  step="0.01"
                />
              </label>

              <label className="inc-description">
                <span className="inc-label-text">Remarks</span>
                <input
                  type="text"
                  name="remarks"
                  value={form.remarks}
                  onChange={handleChange}
                  placeholder="Enter Remarks"
                />
              </label>
            </div>

            {selectedEmployee ? (
              <div className="inc-message" style={{ textAlign: "left" }}>
                <strong>{selectedEmployee.employeeName}</strong> — increment
                month from Employee Master:{" "}
                {selectedEmployee.incrementDate
                  ? formatDate(selectedEmployee.incrementDate)
                  : selectedEmployee.monthOfIncrement
                    ? MONTHS.find(
                        (m) =>
                          Number(m.number) ===
                          Number(selectedEmployee.monthOfIncrement)
                      )?.name || selectedEmployee.monthOfIncrement
                    : "not set"}
              </div>
            ) : null}

            {preview ? (
              <div
                className={`inc-message ${preview.due ? "" : "is-warning"}`}
                style={{ textAlign: "left" }}
              >
                <div style={{ marginBottom: 8 }}>
                  <strong>
                    Increment due:{" "}
                    {preview.due ? "YES" : "NO"}
                  </strong>
                  {"  —  "}
                  {preview.reason}
                </div>

                <div className="inc-preview-grid">
                  <div>
                    <span>Previous Basic</span>
                    <strong>{money(preview.previousBasic)}</strong>
                  </div>
                  <div>
                    <span>Pay Level</span>
                    <strong>
                      {preview.previousPayLevel ?? "—"}
                      {preview.newPayLevel &&
                      preview.newPayLevel !== preview.previousPayLevel
                        ? ` → ${preview.newPayLevel}`
                        : ""}
                    </strong>
                  </div>
                  <div>
                    <span>Current Cell</span>
                    <strong>{preview.previousCellNo ?? "—"}</strong>
                  </div>
                  <div>
                    <span>New Cell</span>
                    <strong>{preview.newCellNo ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Increment Amount</span>
                    <strong>{money(preview.incrementAmount)}</strong>
                  </div>
                  <div>
                    <span>New Basic</span>
                    <strong>{money(preview.newBasic)}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>
                      {preview.source === "matrix"
                        ? "Pay Matrix (next cell)"
                        : preview.source === "manual-basic"
                          ? "Manual New Basic"
                          : preview.source === "manual"
                            ? "Manual amount"
                            : preview.source === "matrix-exhausted"
                              ? "Pay Matrix exhausted"
                              : preview.source === "recorded"
                                ? "Already recorded"
                                : "—"}
                    </strong>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="inc-actions">
              <button
                type="button"
                className="inc-btn cancel"
                onClick={handleCalculate}
                disabled={saving}
              >
                Calculate
              </button>
              <button type="submit" className="inc-btn primary" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
              <button
                type="button"
                className="inc-btn reset"
                onClick={handleReset}
                disabled={saving}
              >
                Reset
              </button>
              <button type="button" className="inc-btn cancel" onClick={onBack}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="inc-card">
        <div className="inc-card-head">
          <span>INCREMENT HISTORY</span>
        </div>

        <div className="inc-card-body">
          <div className="inc-search-grid" style={{ marginBottom: 14 }}>
            <label>
              <span>Institute</span>
              <select
                value={filterInstitute}
                onChange={(event) => setFilterInstitute(event.target.value)}
              >
                <option value="">All Institutes</option>
                {institutes.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.code} — {row.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Employee</span>
              <select
                value={filterEmployee}
                onChange={(event) => setFilterEmployee(event.target.value)}
              >
                <option value="">All Employees</option>
                {employees.map((row) => {
                  const id = row.employeeId ?? row.id;
                  return (
                    <option key={id} value={id}>
                      {row.employeeName || row.name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {error ? <div className="inc-message is-error">{error}</div> : null}

          {loading ? (
            <div className="inc-loading">Loading increment history...</div>
          ) : (
            <DataGrid
              title="Employee Increments"
              rows={records}
              emptyText="No increments recorded."
              defaultPageSize={25}
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                { key: "employeeCode", label: "Employee Code" },
                { key: "employeeName", label: "Employee Name", align: "left" },
                { key: "instituteName", label: "Institute", align: "left" },
                { key: "effectiveMonth", label: "Effective Month" },
                {
                  key: "effectiveDate",
                  label: "Effective Date",
                  type: "date",
                  getValue: (row) => formatDate(row.effectiveDate),
                  render: (row) => formatDate(row.effectiveDate),
                },
                {
                  key: "previousBasic",
                  getValue: (row) => money(row.previousBasic),
                  label: "Previous Basic",
                  type: "number",
                  render: (row) => money(row.previousBasic),
                },
                {
                  key: "incrementAmount",
                  getValue: (row) => money(row.incrementAmount),
                  label: "Increment",
                  type: "number",
                  render: (row) => money(row.incrementAmount),
                },
                {
                  key: "newBasic",
                  getValue: (row) => money(row.newBasic),
                  label: "New Basic",
                  type: "number",
                  render: (row) => <strong>{money(row.newBasic)}</strong>,
                },
                { key: "previousPayLevel", label: "Old Level" },
                { key: "newPayLevel", label: "New Level" },
                {
                  key: "appliedAutomatically",
                  label: "Applied By",
                  getValue: (row) =>
                    row.appliedAutomatically ? "Salary Entry" : "Manual",
                  render: (row) =>
                    row.appliedAutomatically ? "Salary Entry" : "Manual",
                },
                { key: "status", label: "Status", type: "status" },
                { key: "remarks", label: "Remarks", align: "left" },
                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,
                  render: (record) =>
                    String(record.status).toLowerCase() === "active" &&
                    !record.salaryBillCodeId ? (
                      <GridActions
                        onEdit={() => handleEdit(record)}
                        onDelete={() => handleCancelIncrement(record)}
                      />
                    ) : null,
                },
              ]}
            />
          )}
        </div>
      </section>
    </div>
  );
}
