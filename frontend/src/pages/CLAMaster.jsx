import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { apiFetch } from "../utils/authSession";
import "./claMaster.css";
import { API_BASE_URL } from "../utils/apiConfig";

const API_URL = `${API_BASE_URL}/api/cla-master`;

const PAY_LEVEL_GROUPS = [
  "Level 4 and Above",
  "Level 1 to 3",
  "Level 1 to Below",
];

const CITY_CLASSES = [
  "X",
  "Y",
  "Z",
];

const EMPTY_FORM = {
  effectiveDate: "",
  payLevelGroup: "",
  cityClass: "",
  claAmount: "",
  description: "",
  status: "Active",
};

const EMPTY_SEARCH = {
  effectiveDate: "",
  payLevelGroup: "",
  cityClass: "",
  status: "All",
};

export default function CLAMaster({ onBack, user }) {
  const [form, setForm] = useState(EMPTY_FORM);

  const [search, setSearch] = useState(EMPTY_SEARCH);

  const [records, setRecords] = useState([]);

  const [editingId, setEditingId] = useState(null);

  const [loading, setLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");

  const actor = {
    userName: user?.userName || user?.username || "SYSTEM",
    fullName:
      user?.fullName ||
      user?.name ||
      user?.userName ||
      user?.username ||
      "SYSTEM",
  };

  // =========================================================
  // LOAD DATA FROM DATABASE
  // =========================================================

  const loadRecords = async (filters = EMPTY_SEARCH) => {
    try {
      setLoading(true);

      const params = new URLSearchParams();

      if (filters.effectiveDate) {
        params.append("effectiveDate", filters.effectiveDate);
      }

      if (filters.payLevelGroup) {
        params.append("payLevelGroup", filters.payLevelGroup);
      }

      if (filters.cityClass) {
        params.append("cityClass", filters.cityClass);
      }

      if (filters.status && filters.status !== "All") {
        params.append("status", filters.status);
      }

      const query = params.toString();

      const url = query
        ? `${API_URL}?${query}`
        : API_URL;

      const response = await apiFetch(url);

      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok || result?.success === false) {
        throw new Error(
          result?.message || "Unable to load CLA Master."
        );
      }

      const data = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result)
          ? result
          : [];

      setRecords(
        data.map((item) => ({
          ...item,
          id: item.id ?? item.claId ?? item.CLAId,
          claId: item.claId ?? item.CLAId ?? item.id,
          effectiveDate:
            item.effectiveDate ?? item.EffectiveDate ?? "",
          payLevelGroup:
            item.payLevelGroup ?? item.PayLevelGroup ?? "",
          cityClass: item.cityClass ?? item.CityClass ?? "",
          claAmount: item.claAmount ?? item.CLAAmount ?? 0,
          description:
            item.description ?? item.Description ?? "",
          status: item.status ?? item.Status ?? "Active",
        }))
      );
      setMessage("");
    } catch (error) {
      console.error("CLA load error:", error);
      setMessage(error.message || "Unable to load CLA Master.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // LOAD DATA WHEN PAGE OPENS
  // =========================================================

  useEffect(() => {
    loadRecords(EMPTY_SEARCH);
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
    setMessage("");

    if (
      !form.effectiveDate ||
      !form.payLevelGroup ||
      !form.cityClass ||
      form.claAmount === "" ||
      form.claAmount == null
    ) {
      setMessage("Please fill all required fields.");
      return;
    }

    const claAmount = Number(form.claAmount);

    if (!Number.isFinite(claAmount)) {
      setMessage("CLA Amount must be numeric.");
      return;
    }

    if (claAmount < 0) {
      setMessage("CLA Amount cannot be negative.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        effectiveDate: form.effectiveDate,
        payLevelGroup: form.payLevelGroup,
        cityClass: form.cityClass,
        claAmount,
        description: form.description?.trim() || "",
        status: form.status,
        ...actor,
      };

      const url = editingId != null ? `${API_URL}/${editingId}` : API_URL;
      const method = editingId != null ? "PUT" : "POST";

      const response = await apiFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok || result?.success === false) {
        throw new Error(
          result?.message ||
            result?.error ||
            "Unable to save CLA Master."
        );
      }

      if (!result?.data?.claId && !result?.data?.id && !editingId) {
        throw new Error(
          "CLA Master save did not return a SQL CLAId."
        );
      }

      setMessage(
        result.message ||
          (editingId
            ? "CLA Master updated successfully."
            : "CLA Master saved successfully.")
      );

      handleReset();
      setSearch(EMPTY_SEARCH);
      /* Always reload from SQL Server as source of truth */
      await loadRecords(EMPTY_SEARCH);
    } catch (error) {
      console.error("CLA save error:", error);
      setMessage(error.message || "Unable to save CLA Master.");
    } finally {
      setSaving(false);
    }
  };

  // =========================================================
  // EDIT
  // =========================================================

  const handleEdit = (record) => {
    const id =
      record.id ??
      record.claId ??
      record.CLAId;

    setEditingId(id);

    setForm({
      effectiveDate:
        record.effectiveDate ||
        "",

      payLevelGroup:
        record.payLevelGroup ||
        "",

      cityClass:
        record.cityClass ||
        "",

      claAmount:
        record.claAmount ??
        "",

      description:
        record.description ||
        "",

      status:
        record.status ||
        "Active",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // =========================================================
  // DELETE / DEACTIVATE
  // =========================================================

  const handleDelete = async (id) => {
    if (!id) {
      setMessage("Invalid CLA record ID.");
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to deactivate this CLA record?"
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const response = await apiFetch(`${API_URL}/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(actor),
      });

      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok || result?.success === false) {
        throw new Error(
          result?.message || "Unable to deactivate CLA record."
        );
      }

      setMessage(
        result.message || "CLA Master deactivated successfully."
      );
      setSearch(EMPTY_SEARCH);
      await loadRecords(EMPTY_SEARCH);
    } catch (error) {
      console.error("CLA delete error:", error);
      setMessage(error.message || "Unable to deactivate CLA Master.");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // SEARCH
  // =========================================================

  const handleSearch = async () => {
    await loadRecords(search);
  };

  // =========================================================
  // RESET SEARCH
  // =========================================================

  const handleSearchReset = async () => {
    const resetSearch = {
      ...EMPTY_SEARCH,
    };

    setSearch(resetSearch);

    await loadRecords(resetSearch);
  };

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="cla-master">

      {/* BACK */}
      <div className="cla-back">
        <button
          type="button"
          onClick={onBack}
        >
          ← Back to Home
        </button>
      </div>

      {/* PAGE TITLE */}
      <h1 className="cla-page-title">
        CLA MASTER
      </h1>

      {message ? (
        <div
          className="cla-card"
          role="status"
          style={{ marginBottom: 12, padding: "10px 14px" }}
        >
          {message}
        </div>
      ) : null}

      {/* =====================================================
          INFORMATION
      ====================================================== */}

      <section className="cla-card">

        <div className="cla-card-head">
          <span>
            {editingId
              ? "EDIT CLA INFORMATION"
              : "CLA INFORMATION"}
          </span>

          <span className="cla-crumb">
            <Breadcrumb className="cla-crumb" section="Masters" current="CLA Master" />
          </span>
        </div>

        <div className="cla-card-body">

          <form onSubmit={handleSave}>

            <div className="cla-grid">

              {/* EFFECTIVE DATE */}
              <label>
                <span className="cla-label-text">
                  Effective Date <em>*</em>
                </span>

                <input
                  type="date"
                  name="effectiveDate"
                  value={form.effectiveDate}
                  onChange={handleChange}
                />
              </label>

              {/* PAY LEVEL GROUP */}
              <label>
                <span className="cla-label-text">
                  Pay Level Group <em>*</em>
                </span>

                <select
                  name="payLevelGroup"
                  value={form.payLevelGroup}
                  onChange={handleChange}
                >
                  <option value="">
                    Select Pay Level Group
                  </option>

                  {PAY_LEVEL_GROUPS.map(
                    (item) => (
                      <option
                        key={item}
                        value={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>

              {/* CITY CLASS */}
              <label>
                <span className="cla-label-text">
                  City Class <em>*</em>
                </span>

                <select
                  name="cityClass"
                  value={form.cityClass}
                  onChange={handleChange}
                >
                  <option value="">
                    Select City Class
                  </option>

                  {CITY_CLASSES.map(
                    (item) => (
                      <option
                        key={item}
                        value={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>

              {/* CLA AMOUNT */}
              <label>
                <span className="cla-label-text">
                  CLA Amount <em>*</em>
                </span>

                <input
                  type="number"
                  name="claAmount"
                  value={form.claAmount}
                  onChange={handleChange}
                  placeholder="Enter CLA Amount"
                  min="0"
                  step="0.01"
                />
              </label>

              {/* DESCRIPTION */}
              <label className="cla-description">
                <span className="cla-label-text">
                  Description
                </span>

                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Enter Description"
                />
              </label>

              {/* STATUS */}
              <label>
                <span className="cla-label-text">
                  Status <em>*</em>
                </span>

                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Inactive">
                    Inactive
                  </option>
                </select>
              </label>

            </div>

            {/* BUTTONS */}
            <div className="cla-actions">

              <button
                type="submit"
                className="cla-btn primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                  ? "Update"
                  : "Save"}
              </button>

              <button
                type="button"
                className="cla-btn reset"
                onClick={handleReset}
                disabled={saving}
              >
                Reset
              </button>

              <button
                type="button"
                className="cla-btn cancel"
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
      ====================================================== */}

      <section className="cla-card">

        <div className="cla-card-head">
          <span>
            SEARCH CLA
          </span>
        </div>

        <div className="cla-card-body">

          <div className="cla-search-grid">

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

            {/* PAY LEVEL */}
            <label>
              <span>
                Pay Level Group
              </span>

              <select
                name="payLevelGroup"
                value={search.payLevelGroup}
                onChange={handleSearchChange}
              >
                <option value="">
                  All
                </option>

                {PAY_LEVEL_GROUPS.map(
                  (item) => (
                    <option
                      key={item}
                      value={item}
                    >
                      {item}
                    </option>
                  )
                )}
              </select>
            </label>

            {/* CITY */}
            <label>
              <span>
                City Class
              </span>

              <select
                name="cityClass"
                value={search.cityClass}
                onChange={handleSearchChange}
              >
                <option value="">
                  All
                </option>

                {CITY_CLASSES.map(
                  (item) => (
                    <option
                      key={item}
                      value={item}
                    >
                      {item}
                    </option>
                  )
                )}
              </select>
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

            {/* BUTTONS */}
            <div className="cla-search-buttons">

              <button
                type="button"
                className="cla-btn primary"
                onClick={handleSearch}
                disabled={loading}
              >
                {loading
                  ? "Loading..."
                  : "Search"}
              </button>

              <button
                type="button"
                className="cla-btn reset"
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
      ====================================================== */}

      <section className="cla-card">

        <div className="cla-card-head">
          <span>
            CLA LIST
          </span>
        </div>

        <div className="cla-card-body">

          <DataGrid
            title="CLA List"
            rows={records}
            emptyText={
              loading
                ? "Loading CLA records..."
                : "No CLA records found."
            }
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
                key: "payLevelGroup",
                label: "Pay Level Group",
                align: "left",
              },

              {
                key: "cityClass",
                label: "City Class",
                align: "center",
              },

              {
                key: "claAmount",
                label: "CLA Amount",
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
                      handleDelete(
                        record.id ??
                        record.claId ??
                        record.CLAId
                      )
                    }
                  />
                ),
              },
            ]}
          />

        </div>
      </section>

    </div>
  );
}
