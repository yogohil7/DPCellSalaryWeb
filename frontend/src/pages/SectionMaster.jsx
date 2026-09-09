import React, { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid from "../components/DataGrid";
import {
  listAllSections,
  createSection,
  updateSection,
  deleteSection,
  setSectionStatus,
} from "../utils/sectionApi";
import "./sectionMaster.css";

const emptyForm = () => ({
  srNo: "",
  sectionName: "",
  status: "ACTIVE",
});

export default function SectionMaster({ onBack, user }) {
  const [form, setForm] = useState(emptyForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await listAllSections();
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to load sections.",
      });
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
    const srNo = Number(form.srNo);
    const sectionName = String(form.sectionName || "").trim();

    if (!Number.isFinite(srNo) || srNo <= 0) {
      setMessage({ type: "error", text: "Sr. No. is required." });
      return;
    }
    if (!sectionName) {
      setMessage({ type: "error", text: "Section Name is required." });
      return;
    }

    try {
      setLoading(true);
      const payload = {
        srNo,
        sectionName,
        status: form.status || "ACTIVE",
      };

      if (editingId) {
        await updateSection(editingId, payload, user);
        setMessage({ type: "success", text: "Section updated successfully." });
      } else {
        await createSection(payload, user);
        setMessage({ type: "success", text: "Section saved successfully." });
      }

      resetForm();
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to save section.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (row) => {
    setForm({
      srNo: String(row.srNo ?? ""),
      sectionName: row.sectionName || "",
      status: String(row.status || "ACTIVE").toUpperCase(),
    });
    setEditingId(row.sectionId || row.id);
    setMessage({ type: "", text: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (row) => {
    const confirmed = window.confirm(
      `Delete Section "${row.sectionName}"?`
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      await deleteSection(row.sectionId || row.id, user);
      if (editingId === (row.sectionId || row.id)) {
        resetForm();
      }
      setMessage({ type: "success", text: "Section deleted successfully." });
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error.message ||
          "This Section is already in use and cannot be deleted.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (row) => {
    const current = String(row.status || "").toUpperCase();
    const next = current === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      setLoading(true);
      await setSectionStatus(row.sectionId || row.id, next, user);
      setMessage({
        type: "success",
        text: `Section marked as ${next}.`,
      });
      await loadRecords();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to update section status.",
      });
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
        <h1>SECTION MASTER</h1>
      </div>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>
            {editingId ? "Edit Section" : "SECTION INFORMATION"}
          </span>
          <Breadcrumb className="sm-crumb" section="Masters" current="Section Master" />
        </div>

        <div className="sm-card-body">
          <div className="sm-grid">
            <label>
              Sr. No. <em>*</em>
              <input
                type="number"
                min="1"
                step="1"
                value={form.srNo}
                onChange={(e) => handleChange("srNo", e.target.value)}
                placeholder="Enter Sr. No."
              />
            </label>

            <label>
              Section Name <em>*</em>
              <input
                type="text"
                value={form.sectionName}
                onChange={(e) => handleChange("sectionName", e.target.value)}
                placeholder="Enter Section Name"
              />
            </label>

            <label>
              Status <em>*</em>
              <select
                value={form.status}
                onChange={(e) => handleChange("status", e.target.value)}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
          </div>

          {message.text ? (
            <div
              className={`sm-message ${
                message.type === "error" ? "is-error" : "is-success"
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <div className="sm-actions">
            <button
              type="button"
              className="sm-btn primary"
              disabled={loading}
              onClick={handleSave}
            >
              Save
            </button>
            <button type="button" className="sm-btn reset" onClick={resetForm}>
              Reset
            </button>
            <button type="button" className="sm-btn cancel" onClick={onBack}>
              Cancel
            </button>
          </div>
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>SECTION LIST</span>
        </div>
        <div className="sm-card-body sm-list-body">
          <DataGrid
            title="Section List"
            rows={records}
            emptyText={loading ? "Loading..." : "No section records found."}
            columns={[
              {
                key: "srNo",
                label: "Sr. No.",
                align: "center",
                getValue: (row) => row.srNo,
              },
              {
                key: "sectionName",
                label: "Section Name",
                align: "left",
              },
              {
                key: "status",
                label: "Status",
                align: "center",
                render: (row) => (
                  <span
                    className={`data-grid-status is-${String(row.status || "")
                      .toLowerCase()}`}
                  >
                    {String(row.status || "").toUpperCase()}
                  </span>
                ),
              },
              {
                key: "actions",
                label: "Action",
                type: "actions",
                sortable: false,
                exportable: false,
                render: (row) => (
                  <div className="data-grid-actions">
                    <button
                      type="button"
                      className="dg-btn dg-btn-primary"
                      onClick={() => handleEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="dg-btn dg-btn-warning"
                      onClick={() => handleToggleStatus(row)}
                    >
                      {String(row.status || "").toUpperCase() === "ACTIVE"
                        ? "Deactivate"
                        : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="dg-btn dg-btn-danger"
                      onClick={() => handleDelete(row)}
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
