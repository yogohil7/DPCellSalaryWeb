import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  listPayRevisions,
  createPayRevision,
  updatePayRevision,
  setPayRevisionStatus,
  deletePayRevision,
} from "../utils/payRevisionApi";
import "./sectionMaster.css";

const emptyForm = () => ({
  revisionCode: "",
  revisionName: "",
  effectiveFrom: "",
  effectiveTo: "",
  description: "",
  isActive: true,
  status: "Active",
});

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export default function PayRevisionMaster({ onBack, user }) {
  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await listPayRevisions();
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to load pay revisions." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMessage({ type: "", text: "" });
  };

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setMessage({ type: "", text: "" });
  };

  const handleSave = async () => {
    if (!form.revisionCode.trim()) {
      setMessage({ type: "error", text: "Revision Code is required." });
      return;
    }
    if (!form.revisionName.trim()) {
      setMessage({ type: "error", text: "Revision Name is required." });
      return;
    }
    if (!form.effectiveFrom) {
      setMessage({ type: "error", text: "Effective From is required." });
      return;
    }
    if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
      setMessage({ type: "error", text: "Effective To cannot be earlier than Effective From." });
      return;
    }

    const payload = {
      revisionCode: form.revisionCode.trim().toUpperCase(),
      revisionName: form.revisionName.trim(),
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      description: form.description || "",
      status: form.isActive ? "Active" : "Inactive",
      isActive: !!form.isActive,
    };

    try {
      setLoading(true);
      if (editingId) {
        await updatePayRevision(editingId, payload, user);
        setMessage({ type: "success", text: "Pay Revision updated successfully." });
      } else {
        await createPayRevision(payload, user);
        setMessage({ type: "success", text: "Pay Revision saved successfully." });
      }
      resetForm();
      await loadRecords();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to save pay revision." });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (row) => {
    setForm({
      revisionCode: row.revisionCode || "",
      revisionName: row.revisionName || "",
      effectiveFrom: toDateInput(row.effectiveFrom),
      effectiveTo: toDateInput(row.effectiveTo),
      description: row.description || "",
      isActive: row.isActive !== false && String(row.status).toUpperCase() !== "INACTIVE",
      status: row.status || "Active",
    });
    setEditingId(row.payRevisionId || row.id);
    setMessage({ type: "", text: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggle = async (row) => {
    const next = row.isActive ? "Inactive" : "Active";
    try {
      setLoading(true);
      await setPayRevisionStatus(row.payRevisionId || row.id, next, user);
      setMessage({ type: "success", text: `Pay Revision marked as ${next}.` });
      await loadRecords();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to update status." });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete Pay Revision ${row.revisionCode}?`)) return;
    try {
      setLoading(true);
      await deletePayRevision(row.payRevisionId || row.id, user);
      setMessage({ type: "success", text: "Pay Revision deleted successfully." });
      if (editingId === (row.payRevisionId || row.id)) resetForm();
      await loadRecords();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to delete." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="section-master">
      <div className="sm-top">
        <button type="button" className="sm-back" onClick={onBack}>
          ← Back to Home
        </button>
        <h1>PAY REVISION MASTER</h1>
      </div>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>{editingId ? "Edit Pay Revision" : "PAY REVISION INFORMATION"}</span>
          <Breadcrumb className="sm-crumb" section="Masters" current="Pay Revision Master" />
        </div>
        <div className="sm-card-body">
          <div className="sm-grid">
            <label>
              Revision Code <em>*</em>
              <input
                value={form.revisionCode}
                onChange={(e) => handleChange("revisionCode", e.target.value)}
                placeholder="e.g. PR2016"
                disabled={loading}
              />
            </label>
            <label>
              Revision Name <em>*</em>
              <input
                value={form.revisionName}
                onChange={(e) => handleChange("revisionName", e.target.value)}
                placeholder="e.g. 7th Pay Revision"
                disabled={loading}
              />
            </label>
            <label>
              Effective From <em>*</em>
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => handleChange("effectiveFrom", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Effective To
              <input
                type="date"
                value={form.effectiveTo}
                onChange={(e) => handleChange("effectiveTo", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Is Active
              <select
                value={form.isActive ? "1" : "0"}
                onChange={(e) => handleChange("isActive", e.target.value === "1")}
                disabled={loading}
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </label>
            <label>
              Description
              <input
                value={form.description}
                onChange={(e) => handleChange("description", e.target.value)}
                disabled={loading}
              />
            </label>
          </div>

          {message.text ? (
            <div className={`sm-message ${message.type === "error" ? "is-error" : "is-success"}`}>
              {message.text}
            </div>
          ) : null}

          <div className="sm-actions">
            <button type="button" className="sm-btn primary" disabled={loading} onClick={handleSave}>
              {editingId ? "Update" : "Save"}
            </button>
            <button type="button" className="sm-btn reset" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>PAY REVISION LIST</span>
        </div>
        <div className="sm-card-body sm-list-body">
          <DataGrid
            title="Pay Revision List"
            rows={records}
            emptyText={loading ? "Loading..." : "No pay revisions found."}
            columns={[
              { key: "revisionCode", label: "Revision Code", align: "center" },
              { key: "revisionName", label: "Revision Name", align: "left" },
              {
                key: "effectiveFrom",
                label: "Effective From",
                type: "date",
              },
              {
                key: "effectiveTo",
                label: "Effective To",
                type: "date",
              },
              { key: "status", label: "Status", type: "status" },
              {
                key: "actions",
                label: "Actions",
                type: "actions",
                sortable: false,
                exportable: false,
                render: (row) => (
                  <GridActions
                    onEdit={() => handleEdit(row)}
                    onDelete={() => handleDelete(row)}
                    extra={
                      <button
                        type="button"
                        className="grid-action-btn"
                        onClick={() => handleToggle(row)}
                      >
                        {row.isActive ? "Deactivate" : "Activate"}
                      </button>
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
