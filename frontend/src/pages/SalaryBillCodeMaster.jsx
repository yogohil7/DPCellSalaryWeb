import React, { useEffect, useMemo, useState } from "react";
import DataGrid from "../components/DataGrid";
import {
  listSalaryBillCodes,
  createSalaryBillCode,
  updateSalaryBillCode,
  completeSalaryBillCode,
  lockSalaryBillCode,
  copySalaryBillCode,
} from "../utils/salaryBillCodeApi";
import { getSalaryBills } from "../utils/salaryBillStore";
import { isAdminUser } from "../utils/accessControl";
import "./salaryBillCodeMaster.css";

const MONTHS = [
  { value: "01", label: "January", short: "JAN" },
  { value: "02", label: "February", short: "FEB" },
  { value: "03", label: "March", short: "MAR" },
  { value: "04", label: "April", short: "APR" },
  { value: "05", label: "May", short: "MAY" },
  { value: "06", label: "June", short: "JUN" },
  { value: "07", label: "July", short: "JUL" },
  { value: "08", label: "August", short: "AUG" },
  { value: "09", label: "September", short: "SEP" },
  { value: "10", label: "October", short: "OCT" },
  { value: "11", label: "November", short: "NOV" },
  { value: "12", label: "December", short: "DEC" },
];

function availableYears(selectedYear) {
  const currentYear = new Date().getFullYear();
  const startYear = Math.min(currentYear - 1, Number(selectedYear) || currentYear);
  const endYear = Math.max(currentYear + 10, Number(selectedYear) || currentYear);

  return Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => String(startYear + index)
  );
}

function defaultSalaryYear() {
  return String(new Date().getFullYear());
}

const BILL_TYPES = {
  Salary: [
    {
      value: "REGULAR_SALARY",
      label: "Regular Salary",
      suffix: "",
    },
  ],
  Difference: [
    {
      value: "Higher GradePay_DIFFERENCE",
      label: "Higher Gradepay Diff. Difference",
      suffix: "HGP-DIFF",
    },
    {
      value: "DA_DIFFERENCE",
      label: "DA Difference",
      suffix: "DA-DIFF",
    },
    {
      value: "HRA_DIFFERENCE",
      label: "HRA Difference",
      suffix: "HRA-DIFF",
    },
    {
      value: "CLA_DIFFERENCE",
      label: "CLA Difference",
      suffix: "CLA-DIFF",
    },
    {
      value: "MEDICAL_DIFFERENCE",
      label: "Medical Allowance Difference",
      suffix: "MEDICAL-DIFF",
    },
    {
      value: "TA_DIFFERENCE",
      label: "Transport Allowance Difference",
      suffix: "TA-DIFF",
    },
  ],
};

const PENDING_BILL_STATUSES = [
  "DRAFT",
  "SAVED",
  "SUBMITTED",
  "RESUBMITTED",
  "RETURNED",
  "VERIFIED",
];

function monthNameFromValue(monthValue) {
  const month = MONTHS.find((item) => item.value === monthValue);
  return month?.label || "";
}

function generateBillCode(monthValue, year, billCategory, billTypeValue) {
  const month = MONTHS.find((item) => item.value === monthValue);
  if (!month || !year) return "";

  const baseCode = `${month.short}-${year}`;
  const types = BILL_TYPES[billCategory] || [];
  const selected = types.find((item) => item.value === billTypeValue);

  if (billCategory === "Salary" || !selected?.suffix) {
    return baseCode;
  }

  return `${baseCode}-${selected.suffix}`;
}

function emptyForm() {
  return {
    salaryMonth: "",
    salaryYear: defaultSalaryYear(),
    billCategory: "Salary",
    billType: "REGULAR_SALARY",
    billCode: "",
    description: "",
    status: "OPEN",
  };
}

function emptyCopyForm() {
  return {
    salaryMonth: "",
    salaryYear: defaultSalaryYear(),
    billCategory: "Salary",
    billType: "REGULAR_SALARY",
    billCode: "",
    description: "",
  };
}

function SalaryBillCodeMaster({ onBack, user }) {
  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySource, setCopySource] = useState(null);
  const [copyForm, setCopyForm] = useState(emptyCopyForm);
  const canLockMonth = isAdminUser(user);
  const formYears = useMemo(() => availableYears(form.salaryYear), [form.salaryYear]);
  const copyYears = useMemo(
    () => availableYears(copyForm.salaryYear),
    [copyForm.salaryYear]
  );

  const selectedSalaryMonth = MONTHS.find((month) => month.value === form.salaryMonth);
  const availableBillTypes = BILL_TYPES[form.billCategory] || [];
  const selectedBillType = availableBillTypes.find((item) => item.value === form.billType);

  const generatedBillCode = useMemo(
    () =>
      generateBillCode(
        form.salaryMonth,
        form.salaryYear,
        form.billCategory,
        form.billType
      ),
    [form.salaryMonth, form.salaryYear, form.billCategory, form.billType]
  );

  const generatedCopyBillCode = useMemo(
    () =>
      generateBillCode(
        copyForm.salaryMonth,
        copyForm.salaryYear,
        copyForm.billCategory,
        copyForm.billType
      ),
    [copyForm.salaryMonth, copyForm.salaryYear, copyForm.billCategory, copyForm.billType]
  );

  useEffect(() => {
    if (viewOnly) return;
    setForm((current) => ({
      ...current,
      billCode: generatedBillCode,
    }));
  }, [generatedBillCode, viewOnly]);

  useEffect(() => {
    setCopyForm((current) => ({
      ...current,
      billCode: generatedCopyBillCode,
    }));
  }, [generatedCopyBillCode]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await listSalaryBillCodes({ category: "Salary" });
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to load Salary Bill Codes. Is the backend running?",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const handleCategoryChange = (value) => {
    if (viewOnly) return;
    const firstType = BILL_TYPES[value]?.[0];
    setForm((current) => ({
      ...current,
      billCategory: value,
      billType: firstType?.value || "",
    }));
    setMessage({ type: "", text: "" });
  };

  const handleChange = (field, value) => {
    if (viewOnly) return;
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setMessage({ type: "", text: "" });
  };

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setViewOnly(false);
    setMessage({ type: "", text: "" });
  };

  const validateForm = () => {
    if (!form.salaryMonth) {
      setMessage({ type: "error", text: "Please select Salary Month." });
      return false;
    }
    if (!form.salaryYear) {
      setMessage({ type: "error", text: "Please select Salary Year." });
      return false;
    }
    if (!form.billCategory) {
      setMessage({ type: "error", text: "Please select Bill Category." });
      return false;
    }
    if (!form.billType) {
      setMessage({ type: "error", text: "Please select Bill Type." });
      return false;
    }
    if (!form.billCode) {
      setMessage({ type: "error", text: "Bill Code could not be generated." });
      return false;
    }
    return true;
  };

  const buildPayload = () => ({
    billCode: form.billCode,
    salaryMonth: monthNameFromValue(form.salaryMonth),
    salaryMonthNumber: form.salaryMonth,
    salaryYear: form.salaryYear,
    billCategory: form.billCategory,
    billType: selectedBillType?.label || form.billType,
    description: form.description,
  });

  const handleSave = async () => {
    if (viewOnly) {
      setMessage({
        type: "error",
        text: "This Bill Code is read-only.",
      });
      return;
    }

    if (!validateForm()) return;

    try {
      setLoading(true);
      if (editingId) {
        await updateSalaryBillCode(editingId, buildPayload(), user);
        setMessage({
          type: "success",
          text: `Salary Bill Code ${form.billCode} updated successfully.`,
        });
      } else {
        await createSalaryBillCode(buildPayload(), user);
        setMessage({
          type: "success",
          text: `Salary Bill Code ${form.billCode} created successfully.`,
        });
      }
      resetForm();
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to save bill code.",
      });
    } finally {
      setLoading(false);
    }
  };

  const fillFormFromRecord = (record, readOnly) => {
    const category = record.billCategory;
    const typeMatch = (BILL_TYPES[category] || []).find(
      (item) => item.label === record.billType || item.value === record.billType
    );

    const salaryMonthNumber =
      record.salaryMonthNumber ||
      MONTHS.find((m) => record.salaryMonth?.startsWith(m.short))?.value ||
      "";

    setForm({
      salaryMonth: salaryMonthNumber,
      salaryYear: record.salaryYear,
      billCategory: category,
      billType: typeMatch?.value || BILL_TYPES[category]?.[0]?.value || "",
      billCode: record.billCode,
      description: record.description || "",
      status: record.status,
    });

    setEditingId(record.id || record.billCodeId);
    setViewOnly(Boolean(readOnly));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleView = (record) => {
    fillFormFromRecord(record, true);
    setMessage({ type: "", text: "" });
  };

  const handleEdit = (record) => {
    const status = String(record.status || "").trim().toUpperCase();
    if (status === "LOCKED") {
      setMessage({
        type: "error",
        text: `Bill Code ${record.billCode} is locked and cannot be modified.`,
      });
      return;
    }
    if (status !== "OPEN") {
      setMessage({
        type: "error",
        text: `Only OPEN Bill Codes can be edited. ${record.billCode} is ${status}.`,
      });
      return;
    }
    fillFormFromRecord(record, false);
    setMessage({ type: "", text: "" });
  };

  const handleComplete = async (record) => {
    if (!canLockMonth) {
      setMessage({
        type: "error",
        text: "Only System Administrator can complete / lock salary months.",
      });
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to mark Bill Code ${record.billCode} as COMPLETED?`
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      await completeSalaryBillCode(record.id || record.billCodeId, user);
      setMessage({
        type: "success",
        text: `Bill Code ${record.billCode} marked as COMPLETED.`,
      });
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to complete bill code.",
      });
    } finally {
      setLoading(false);
    }
  };

  const hasLocalPendingBills = (billCode) => {
    const bills = getSalaryBills();
    return bills.some(
      (bill) =>
        String(bill.billCode) === String(billCode) &&
        PENDING_BILL_STATUSES.includes(String(bill.status || "").toUpperCase())
    );
  };

  const handleLock = async (record) => {
    if (!canLockMonth) {
      setMessage({
        type: "error",
        text: "Only System Administrator can lock salary months.",
      });
      return;
    }
    const status = String(record.status || "").trim().toUpperCase();
    if (status !== "COMPLETED") {
      setMessage({
        type: "error",
        text: "Bill Code must be COMPLETED before it can be locked.",
      });
      return;
    }

    if (hasLocalPendingBills(record.billCode)) {
      setMessage({
        type: "error",
        text: `Bill Code ${record.billCode} cannot be locked because some salary bills are still pending.`,
      });
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to lock salary month ${record.billCode}?`
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      await lockSalaryBillCode(record.id || record.billCodeId, user);
      setMessage({
        type: "success",
        text: `Salary month ${record.billCode} has been locked successfully.`,
      });
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to lock bill code.",
      });
    } finally {
      setLoading(false);
    }
  };

  const openCopyModal = (record) => {
    const status = String(record.status || "").trim().toUpperCase();
    if (status !== "LOCKED" && status !== "APPROVED") {
      setMessage({
        type: "error",
        text: "Only APPROVED or LOCKED Bill Codes can be copied to a new month.",
      });
      return;
    }

    const nextMonthIndex =
      MONTHS.findIndex(
        (m) =>
          record.salaryMonth?.startsWith(m.short) ||
          record.billCode?.startsWith(m.short)
      ) + 1;
    const next =
      nextMonthIndex > 0 && nextMonthIndex < MONTHS.length
        ? MONTHS[nextMonthIndex]
        : MONTHS[0];
    const nextYear =
      nextMonthIndex >= MONTHS.length
        ? String(Number(record.salaryYear) + 1)
        : record.salaryYear;

    const category = record.billCategory;
    const typeMatch = (BILL_TYPES[category] || []).find(
      (item) => item.label === record.billType || item.value === record.billType
    );

    setCopySource(record);
    setCopyForm({
      salaryMonth: next.value,
      salaryYear: nextYear,
      billCategory: category,
      billType: typeMatch?.value || BILL_TYPES[category]?.[0]?.value || "",
      billCode: "",
      description: record.description || `${next.label} Salary`,
    });
    setCopyOpen(true);
  };

  const handleCopyCreate = async () => {
    if (!copySource) return;

    if (!copyForm.salaryMonth || !copyForm.salaryYear) {
      setMessage({
        type: "error",
        text: "Please select New Salary Month and Year.",
      });
      return;
    }

    const typeLabel =
      (BILL_TYPES[copyForm.billCategory] || []).find(
        (item) => item.value === copyForm.billType
      )?.label || copyForm.billType;

    const payload = {
      salaryMonth: monthNameFromValue(copyForm.salaryMonth),
      salaryMonthNumber: copyForm.salaryMonth,
      salaryYear: copyForm.salaryYear,
      billCategory: copyForm.billCategory,
      billType: typeLabel,
      billCode: copyForm.billCode || generatedCopyBillCode,
      description: copyForm.description,
    };

    if (!payload.billCode) {
      setMessage({
        type: "error",
        text: "New Bill Code could not be generated.",
      });
      return;
    }

    try {
      setLoading(true);
      await copySalaryBillCode(copySource.id || copySource.billCodeId, payload, user);
      setCopyOpen(false);
      setCopySource(null);
      setMessage({
        type: "success",
        text: `Bill Code ${payload.billCode} created from ${copySource.billCode}.`,
      });
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to copy bill code.",
      });
    } finally {
      setLoading(false);
    }
  };

  const normalizeStatus = (status) =>
    String(status || "")
      .trim()
      .toUpperCase();

  const renderStatus = (record) => {
    const key = normalizeStatus(record.status).toLowerCase();
    const status = normalizeStatus(record.status);
    return (
      <span className={`data-grid-status is-${key}`}>
        {status === "LOCKED" ? "🔒 LOCKED" : status || "-"}
      </span>
    );
  };

  const renderActions = (record) => {
    const status = normalizeStatus(record.status);

    if (status === "OPEN") {
      return (
        <div className="data-grid-actions">
          <button
            type="button"
            className="dg-btn dg-btn-primary"
            onClick={() => handleEdit(record)}
          >
            Edit
          </button>
          {canLockMonth ? (
            <button
              type="button"
              className="dg-btn dg-btn-success"
              onClick={() => handleComplete(record)}
            >
              Complete
            </button>
          ) : null}
        </div>
      );
    }

    if (status === "COMPLETED") {
      if (!canLockMonth) {
        return (
          <span className="data-grid-status is-completed">COMPLETED</span>
        );
      }
      return (
        <div className="data-grid-actions">
          <button
            type="button"
            className="dg-btn dg-btn-warning"
            onClick={() => handleLock(record)}
          >
            Lock Month
          </button>
        </div>
      );
    }

    if (status === "LOCKED" || status === "APPROVED") {
      return (
        <div className="data-grid-actions">
          {canLockMonth ? (
            <button
              type="button"
              className="dg-btn dg-btn-primary"
              onClick={() => openCopyModal(record)}
            >
              Copy to New Month
            </button>
          ) : (
            <span className="data-grid-status is-locked">LOCKED</span>
          )}
        </div>
      );
    }

    return null;
  };

  const formLocked =
    viewOnly ||
    normalizeStatus(form.status) === "LOCKED" ||
    normalizeStatus(form.status) === "COMPLETED";

  return (
    <div className="sbc-page">
      <button
        type="button"
        className="sbc-back-button"
        onClick={() => onBack && onBack()}
      >
        ← Back to Home
      </button>

      <h1 className="sbc-page-title">SALARY BILL CODE MASTER</h1>

      <section className="sbc-card">
        <div className="sbc-section-title">
          <span>
            {viewOnly
              ? "View Salary Bill Code"
              : editingId
                ? "Edit Salary Bill Code"
                : "Create Salary Bill Code"}
          </span>
          <div className="sbc-breadcrumb">Master / Salary Bill Code</div>
        </div>

        <div className="sbc-form">
          <label>
            <span className="sbc-label-text">
              Salary Month <em>*</em>
            </span>
            <select
              value={form.salaryMonth}
              disabled={formLocked}
              onChange={(e) => handleChange("salaryMonth", e.target.value)}
            >
              <option value="">Select Salary Month</option>
              {MONTHS.map((month) => (
                <option key={`sal-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sbc-label-text">
              Salary Year <em>*</em>
            </span>
            <select
              value={form.salaryYear}
              disabled={formLocked}
              onChange={(e) => handleChange("salaryYear", e.target.value)}
            >
              {formYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sbc-label-text">
              Bill Category <em>*</em>
            </span>
            <select
              value={form.billCategory}
              disabled={formLocked}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="Salary">Salary</option>
              <option value="Difference">Difference</option>
            </select>
          </label>

          <label>
            <span className="sbc-label-text">
              Bill Type <em>*</em>
            </span>
            <select
              value={form.billType}
              disabled={formLocked}
              onChange={(e) => handleChange("billType", e.target.value)}
            >
              {availableBillTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sbc-label-text">
              Bill Code <em>*</em>
            </span>
            <input
              type="text"
              value={form.billCode}
              readOnly
              placeholder="Auto Generated"
              className="sbc-readonly"
            />
          </label>

          <label className="sbc-description-field">
            <span className="sbc-label-text">Description</span>
            <input
              type="text"
              value={form.description}
              disabled={formLocked}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Enter description"
            />
          </label>

          <label>
            <span className="sbc-label-text">Status</span>
            <input
              type="text"
              className="sbc-readonly"
              readOnly
              value={form.status || "OPEN"}
            />
          </label>
        </div>

        <div className="sbc-preview">
          <div className="sbc-preview-label">Bill Code Preview</div>
          <div className="sbc-preview-code">{generatedBillCode || "—"}</div>
          <div className="sbc-preview-help">
            {!form.salaryMonth
              ? "Select Salary Month, Year, Category and Bill Type"
              : selectedSalaryMonth
                ? `Generated from ${selectedSalaryMonth.label} ${form.salaryYear}`
                : "Bill code generated automatically"}
          </div>
        </div>

        {message.text ? (
          <div
            className={`sbc-message ${
              message.type === "error"
                ? "sbc-message-error"
                : "sbc-message-success"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <div className="sbc-form-actions">
          {!formLocked ? (
            <button
              type="button"
              className="sbc-btn sbc-btn-save"
              disabled={loading}
              onClick={handleSave}
            >
              Save
            </button>
          ) : null}

          <button
            type="button"
            className="sbc-btn sbc-btn-reset"
            onClick={resetForm}
          >
            Reset
          </button>

          <button
            type="button"
            className="sbc-btn sbc-btn-cancel"
            onClick={() => onBack && onBack()}
          >
            Cancel
          </button>
        </div>
      </section>

      <section className="sbc-card sbc-list-card">
        <div className="sbc-section-title">
          <span>Salary Bill Code List</span>
        </div>

        <DataGrid
          title="Salary Bill Code List"
          rows={records}
          emptyText={loading ? "Loading..." : "No Bill Code found"}
          columns={[
            { key: "sr", label: "Sr. No.", type: "serial" },
            {
              key: "monthName",
              label: "Month",
              align: "center",
              getValue: (row) => row.monthName || row.salaryMonth || "",
            },
            { key: "salaryYear", label: "Year", align: "center" },
            { key: "billCategory", label: "Category", align: "left" },
            { key: "billType", label: "Bill Type", align: "left" },
            { key: "billCode", label: "Bill Code", align: "center" },
            { key: "description", label: "Description", align: "left" },
            {
              key: "status",
              label: "Status",
              align: "center",
              sortable: true,
              render: (row) => renderStatus(row),
            },
            {
              key: "lockedBy",
              label: "Locked By",
              align: "left",
              getValue: (row) => row.lockedBy || "",
            },
            {
              key: "lockedDate",
              label: "Locked Date",
              align: "center",
              getValue: (row) =>
                row.lockedDate
                  ? new Date(row.lockedDate).toLocaleString()
                  : "",
            },
            {
              key: "actions",
              label: "Action",
              type: "actions",
              sortable: false,
              exportable: false,
              render: (row) => renderActions(row),
            },
          ]}
        />
      </section>

      {copyOpen && copySource ? (
        <div className="sbc-modal-overlay">
          <div className="sbc-modal" role="dialog" aria-modal="true">
            <div className="sbc-modal-head">COPY BILL CODE</div>
            <div className="sbc-modal-body">
              <div className="sbc-copy-source">
                Source Bill Code: <strong>{copySource.billCode}</strong>
              </div>

              <div className="sbc-form sbc-copy-form">
                <label>
                  <span className="sbc-label-text">New Salary Month</span>
                  <select
                    value={copyForm.salaryMonth}
                    onChange={(e) =>
                      setCopyForm((prev) => ({
                        ...prev,
                        salaryMonth: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select</option>
                    {MONTHS.map((month) => (
                      <option key={`c-sal-${month.value}`} value={month.value}>
                        {month.short}-{copyForm.salaryYear} ({month.label})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="sbc-label-text">New Salary Year</span>
                  <select
                    value={copyForm.salaryYear}
                    onChange={(e) =>
                      setCopyForm((prev) => ({
                        ...prev,
                        salaryYear: e.target.value,
                      }))
                    }
                  >
                    {copyYears.map((year) => (
                      <option key={`c-year-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="sbc-label-text">New Bill Category</span>
                  <select
                    value={copyForm.billCategory}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCopyForm((prev) => ({
                        ...prev,
                        billCategory: value,
                        billType: BILL_TYPES[value]?.[0]?.value || "",
                      }));
                    }}
                  >
                    <option value="Salary">Salary</option>
                    <option value="Difference">Difference</option>
                  </select>
                </label>

                <label>
                  <span className="sbc-label-text">New Bill Type</span>
                  <select
                    value={copyForm.billType}
                    onChange={(e) =>
                      setCopyForm((prev) => ({
                        ...prev,
                        billType: e.target.value,
                      }))
                    }
                  >
                    {(BILL_TYPES[copyForm.billCategory] || []).map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="sbc-label-text">New Bill Code</span>
                  <input
                    type="text"
                    className="sbc-readonly"
                    readOnly
                    value={copyForm.billCode || generatedCopyBillCode}
                  />
                </label>

                <label className="sbc-description-field">
                  <span className="sbc-label-text">Description</span>
                  <input
                    type="text"
                    value={copyForm.description}
                    onChange={(e) =>
                      setCopyForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="sbc-modal-actions">
              <button
                type="button"
                className="sbc-btn sbc-btn-cancel"
                onClick={() => {
                  setCopyOpen(false);
                  setCopySource(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sbc-btn sbc-btn-save"
                disabled={loading}
                onClick={handleCopyCreate}
              >
                Copy &amp; Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SalaryBillCodeMaster;
