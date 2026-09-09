import { useCallback, useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import ModuleFrame from "../components/ModuleFrame";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  createDaMaster,
  deleteDaMaster,
  listDaMaster,
  updateDaMaster,
} from "../utils/daMasterApi";
import "./DAMaster.css";

const initialForm = {
  effectiveDate: "",
  daPercentage: "",
  description: "",
  status: "Active",
};

const initialSearch = {
  effectiveDate: "",
  daPercentage: "",
  status: "All",
};

export default function DAMaster({ onBack, user }) {
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState(initialSearch);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const setSearchField = (field, value) => {
    setSearch((prev) => ({ ...prev, [field]: value }));
  };

  const loadRecords = useCallback(async (filters = {}) => {
    setLoading(true);
    try {
      const data = await listDaMaster(filters);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error.message || "Unable to load DA Master.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setMessage("");
  };

  const handleSave = async (e) => {
    e.preventDefault();

    if (!form.effectiveDate) {
      setMessage("Please select Effective From Date.");
      return;
    }
    if (form.daPercentage === "" || form.daPercentage == null) {
      setMessage("Please enter DA Percentage.");
      return;
    }
    const pct = Number(form.daPercentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setMessage("DA Percentage must be between 0 and 100.");
      return;
    }
    if (!form.status) {
      setMessage("Status is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        effectiveDate: form.effectiveDate,
        daPercentage: pct,
        description: form.description,
        status: form.status,
      };

      if (editingId) {
        const result = await updateDaMaster(editingId, payload, user);
        setMessage(result.message || "DA Master updated successfully.");
      } else {
        const result = await createDaMaster(payload, user);
        setMessage(result.message || "DA Master saved successfully.");
      }

      setForm(initialForm);
      setEditingId(null);
      await loadRecords(search);
    } catch (error) {
      setMessage(error.message || "Unable to save DA Master.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record) => {
    setForm({
      effectiveDate: record.effectiveDate || "",
      daPercentage: record.daPercentage ?? "",
      description: record.description || "",
      status: record.status || "Active",
    });
    setEditingId(record.id || record.daId);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Deactivate this DA record? Historical rates are preserved as Inactive."
    );
    if (!confirmDelete) return;

    try {
      const result = await deleteDaMaster(id, user);
      setMessage(result.message || "DA record deactivated successfully.");
      if (editingId === id) resetForm();
      await loadRecords(search);
    } catch (error) {
      setMessage(error.message || "Unable to delete DA Master.");
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setMessage("");
    await loadRecords(search);
  };

  const handleResetSearch = async () => {
    setSearch(initialSearch);
    await loadRecords({});
  };

  const filteredRecords = useMemo(() => records, [records]);

  return (
    <ModuleFrame title="DA MASTER" onBack={onBack}>
      <div className="da-master">
        <section className="da-card">
          <div className="da-card-head">
            <span>DA INFORMATION</span>
            <Breadcrumb className="da-crumb" section="Masters" current="DA Master" />
          </div>

          <form onSubmit={handleSave}>
            <div className="da-card-body">
              <div className="da-grid">
                <div className="da-field">
                  <label>
                    Effective From Date <em>*</em>
                  </label>
                  <input
                    type="date"
                    value={form.effectiveDate}
                    onChange={(e) => setField("effectiveDate", e.target.value)}
                  />
                </div>

                <div className="da-field">
                  <label>
                    DA Percentage (%) <em>*</em>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={form.daPercentage}
                    onChange={(e) => setField("daPercentage", e.target.value)}
                    placeholder="Enter DA Percentage"
                  />
                </div>

                <div className="da-field da-description">
                  <label>Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder="Enter Description"
                    rows="2"
                  />
                </div>

                <div className="da-field">
                  <label>
                    Status <em>*</em>
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setField("status", e.target.value)}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {message && <div className="da-message">{message}</div>}

              <div className="da-actions">
                <button
                  type="submit"
                  className="da-btn da-primary"
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
                  className="da-btn da-reset"
                  onClick={resetForm}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="da-btn da-cancel"
                  onClick={onBack}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="da-card">
          <div className="da-card-head">
            <span>SEARCH DA</span>
          </div>
          <form onSubmit={handleSearch}>
            <div className="da-search-body">
              <div className="da-search-row">
                <div className="da-field">
                  <label>Effective Date</label>
                  <input
                    type="date"
                    value={search.effectiveDate}
                    onChange={(e) =>
                      setSearchField("effectiveDate", e.target.value)
                    }
                  />
                </div>
                <div className="da-field">
                  <label>DA Percentage</label>
                  <input
                    type="text"
                    value={search.daPercentage}
                    onChange={(e) =>
                      setSearchField("daPercentage", e.target.value)
                    }
                    placeholder="DA Percentage"
                  />
                </div>
                <div className="da-field">
                  <label>Status</label>
                  <select
                    value={search.status}
                    onChange={(e) => setSearchField("status", e.target.value)}
                  >
                    <option value="All">All</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="da-search-buttons">
                  <button type="submit" className="da-btn da-primary">
                    Search
                  </button>
                  <button
                    type="button"
                    className="da-btn da-reset"
                    onClick={handleResetSearch}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </form>
        </section>

        <section className="da-card">
          <div className="da-card-head">
            <span>DA LIST {loading ? "(Loading...)" : ""}</span>
          </div>
          <div className="da-list-body">
            <DataGrid
              title="DA List"
              rows={filteredRecords}
              emptyText="No DA records found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                {
                  key: "effectiveDate",
                  label: "Effective Date",
                  type: "date",
                },
                {
                  key: "daPercentage",
                  label: "DA Percentage",
                  align: "right",
                  getValue: (row) => `${row.daPercentage}%`,
                },
                {
                  key: "description",
                  label: "Description",
                  align: "left",
                },
                { key: "status", label: "Status", type: "status" },
                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,
                  render: (item) => (
                    <GridActions
                      onEdit={() => handleEdit(item)}
                      onDelete={() => handleDelete(item.id)}
                    />
                  ),
                },
              ]}
            />
          </div>
        </section>
      </div>
    </ModuleFrame>
  );
}
