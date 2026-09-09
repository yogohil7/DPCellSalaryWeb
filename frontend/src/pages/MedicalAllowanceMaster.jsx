import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { apiFetch } from "../utils/authSession";
import "./medicalAllowanceMaster.css";
import { API_BASE_URL } from "../utils/apiConfig";

const API_URL = `${API_BASE_URL}/api/medical-allowance-master`;

const EMPTY_FORM = {
  effectiveDate: "",
  allowanceName: "",
  amount: "",
  description: "",
  status: "Active",
};

const EMPTY_SEARCH = {
  effectiveDate: "",
  amount: "",
  status: "All",
};

export default function MedicalAllowanceMaster({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState(EMPTY_SEARCH);

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // null = Add mode
  // number = Edit mode
  const [editingId, setEditingId] = useState(null);

  // =========================================================
  // LOAD RECORDS
  // =========================================================

  const loadRecords = async (filters = EMPTY_SEARCH) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();

      if (filters.effectiveDate) {
        params.append("effectiveDate", filters.effectiveDate);
      }

      if (
        filters.amount !== "" &&
        filters.amount !== null &&
        filters.amount !== undefined
      ) {
        params.append("amount", filters.amount);
      }

      if (filters.status && filters.status !== "All") {
        params.append("status", filters.status);
      }

      const url =
        params.toString().length > 0
          ? `${API_URL}?${params.toString()}`
          : API_URL;

      const response = await apiFetch(url);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to load Medical Allowance records."
        );
      }

      setRecords(result.data || []);
    } catch (error) {
      console.error("Load Medical Allowance error:", error);

      alert(
        error.message ||
          "Unable to load Medical Allowance records."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  // =========================================================
  // FORM CHANGE
  // =========================================================

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // =========================================================
  // SEARCH CHANGE
  // =========================================================

  const handleSearchChange = (e) => {
    const { name, value } = e.target;

    setSearch((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // =========================================================
  // RESET FORM
  // =========================================================

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  // =========================================================
  // SAVE / UPDATE
  // =========================================================

  const handleSave = async (e) => {
    e.preventDefault();

    if (!form.effectiveDate) {
      alert("Please select Effective Date.");
      return;
    }

    if (!form.allowanceName.trim()) {
      alert("Please enter Allowance Name.");
      return;
    }

    if (
      form.amount === "" ||
      form.amount === null ||
      Number.isNaN(Number(form.amount))
    ) {
      alert("Please enter Medical Allowance Amount.");
      return;
    }

    if (Number(form.amount) < 0) {
      alert("Medical Allowance Amount cannot be negative.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        effectiveDate: form.effectiveDate,
        allowanceName: form.allowanceName.trim(),
        amount: Number(form.amount),
        description: form.description.trim(),
        status: form.status,
      };

      const url =
        editingId !== null
          ? `${API_URL}/${editingId}`
          : API_URL;

      const method =
        editingId !== null ? "PUT" : "POST";

      const response = await apiFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to save Medical Allowance."
        );
      }

      alert(
        editingId !== null
          ? "Medical Allowance updated successfully."
          : "Medical Allowance saved successfully."
      );

      handleReset();
      await loadRecords(search);
    } catch (error) {
      console.error("Save Medical Allowance error:", error);

      alert(
        error.message ||
          "Unable to save Medical Allowance."
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================================================
  // SEARCH
  // =========================================================

  const handleSearch = async () => {
    await loadRecords(search);
  };

  // =========================================================
  // SEARCH RESET
  // =========================================================

  const handleSearchReset = async () => {
    setSearch(EMPTY_SEARCH);
    await loadRecords(EMPTY_SEARCH);
  };

  // =========================================================
  // EDIT
  // =========================================================

  const handleEdit = (record) => {
    setEditingId(record.id);

    setForm({
      effectiveDate: record.effectiveDate || "",
      allowanceName: record.allowanceName || "",
      amount:
        record.amount !== null &&
        record.amount !== undefined
          ? String(record.amount)
          : "",
      description: record.description || "",
      status: record.status || "Active",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // =========================================================
  // DELETE / SOFT DELETE
  // =========================================================

  const handleDelete = async (id) => {
    if (
      !window.confirm(
        "Are you sure you want to deactivate this Medical Allowance record?"
      )
    ) {
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: "System Administrator",
          fullName: "System Administrator",
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to deactivate Medical Allowance."
        );
      }

      alert(
        "Medical Allowance deactivated successfully."
      );

      await loadRecords(search);
    } catch (error) {
      console.error(
        "Delete Medical Allowance error:",
        error
      );

      alert(
        error.message ||
          "Unable to deactivate Medical Allowance."
      );
    }
  };

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="medical-master">

      {/* =====================================================
          BACK
      ===================================================== */}

      <div className="medical-back">
        <button type="button" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      {/* =====================================================
          TITLE
      ===================================================== */}

      <h1 className="medical-page-title">
        MEDICAL ALLOWANCE MASTER
      </h1>

      {/* =====================================================
          INFORMATION
      ===================================================== */}

      <section className="medical-card">

        <div className="medical-card-head">
          <span>
            MEDICAL ALLOWANCE INFORMATION
          </span>

          <span className="medical-crumb">
            <Breadcrumb className="medical-crumb" section="Masters" current="Medical Allowance Master" />
          </span>
        </div>

        <div className="medical-card-body">

          <form onSubmit={handleSave}>

            <div className="medical-grid">

              {/* EFFECTIVE DATE */}

              <label>
                <span className="medical-label-text">
                  Effective Date <em>*</em>
                </span>

                <input
                  type="date"
                  name="effectiveDate"
                  value={form.effectiveDate}
                  onChange={handleChange}
                  disabled={saving}
                />
              </label>

              {/* ALLOWANCE NAME */}

              <label>
                <span className="medical-label-text">
                  Allowance Name <em>*</em>
                </span>

                <input
                  type="text"
                  name="allowanceName"
                  value={form.allowanceName}
                  onChange={handleChange}
                  placeholder="Enter Allowance Name"
                  disabled={saving}
                />
              </label>

              {/* AMOUNT */}

              <label>
                <span className="medical-label-text">
                  Medical Allowance Amount <em>*</em>
                </span>

                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="Enter Medical Allowance"
                  min="0"
                  step="0.01"
                  disabled={saving}
                />
              </label>

              {/* STATUS */}

              <label>
                <span className="medical-label-text">
                  Status <em>*</em>
                </span>

                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  disabled={saving}
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Inactive">
                    Inactive
                  </option>
                </select>
              </label>

              {/* DESCRIPTION */}

              <label className="medical-description">
                <span className="medical-label-text">
                  Description
                </span>

                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Enter Description"
                  disabled={saving}
                />
              </label>

            </div>

            {/* BUTTONS */}

            <div className="medical-actions">

              <button
                type="submit"
                className="medical-btn primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId !== null
                  ? "Update"
                  : "Save"}
              </button>

              <button
                type="button"
                className="medical-btn reset"
                onClick={handleReset}
                disabled={saving}
              >
                Reset
              </button>

              <button
                type="button"
                className="medical-btn cancel"
                onClick={onBack}
                disabled={saving}
              >
                Cancel
              </button>

            </div>

          </form>

        </div>
      </section>

      {/* =====================================================
          SEARCH
      ===================================================== */}

      <section className="medical-card">

        <div className="medical-card-head">
          <span>
            SEARCH MEDICAL ALLOWANCE
          </span>
        </div>

        <div className="medical-card-body">

          <div className="medical-search-grid">

            {/* DATE */}

            <label>
              <span>
                Effective Date
              </span>

              <input
                type="date"
                name="effectiveDate"
                value={search.effectiveDate}
                onChange={handleSearchChange}
              />
            </label>

            {/* AMOUNT */}

            <label>
              <span>
                Medical Allowance
              </span>

              <input
                type="number"
                name="amount"
                value={search.amount}
                onChange={handleSearchChange}
                placeholder="Medical Allowance"
                min="0"
                step="0.01"
              />
            </label>

            {/* STATUS */}

            <label>
              <span>
                Status
              </span>

              <select
                name="status"
                value={search.status}
                onChange={handleSearchChange}
              >
                <option value="All">
                  All
                </option>

                <option value="Active">
                  Active
                </option>

                <option value="Inactive">
                  Inactive
                </option>
              </select>
            </label>

            {/* SEARCH BUTTONS */}

            <div className="medical-search-buttons">

              <button
                type="button"
                className="medical-btn primary"
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </button>

              <button
                type="button"
                className="medical-btn reset"
                onClick={handleSearchReset}
                disabled={loading}
              >
                Reset
              </button>

            </div>

          </div>

        </div>
      </section>

      {/* =====================================================
          LIST
      ===================================================== */}

      <section className="medical-card">

        <div className="medical-card-head">
          <span>
            MEDICAL ALLOWANCE LIST
          </span>
        </div>

        <div className="medical-card-body">

          {loading ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
              }}
            >
              Loading Medical Allowance records...
            </div>
          ) : (
            <DataGrid
              title="Medical Allowance List"
              rows={records}
              emptyText="No Medical Allowance records found."
              columns={[
                {
                  key: "sr",
                  label: "Sr. No.",
                  type: "serial",
                },

                {
                  key: "effectiveDate",
                  label: "Effective Date",
                  type: "date",
                },

                {
                  key: "allowanceName",
                  label: "Allowance Name",
                  align: "left",
                },

                {
                  key: "amount",
                  label: "Medical Allowance",
                  type: "number",
                },

                {
                  key: "description",
                  label: "Description",
                  align: "left",
                },

                {
                  key: "status",
                  label: "Status",
                  type: "status",
                },

                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,

                  render: (record) => (
                    <GridActions
                      onEdit={() =>
                        handleEdit(record)
                      }
                      onDelete={() =>
                        handleDelete(record.id)
                      }
                    />
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
