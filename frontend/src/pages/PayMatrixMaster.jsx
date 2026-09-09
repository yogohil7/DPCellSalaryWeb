import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { listActivePayRevisions } from "../utils/payRevisionApi";
import {
  listPayMatrix,
  createPayMatrix,
  updatePayMatrix,
  deletePayMatrix,
  importPayMatrixExcel,
  downloadPayMatrixTemplate,
} from "../utils/payMatrixApi";
import "./sectionMaster.css";

const emptyForm = () => ({
  payRevisionId: "",
  level: "",
  cellNo: "",
  basicPay: "",
  effectiveDate: "",
  payCommission: "7th CPC",
  status: "Active",
});

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export default function PayMatrixMaster({ onBack, user }) {
  const [form, setForm] = useState(emptyForm);
  const [revisions, setRevisions] = useState([]);
  const [filterRevisionId, setFilterRevisionId] = useState("");
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const loadRevisions = async () => {
    try {
      const data = await listActivePayRevisions();
      const list = Array.isArray(data) ? data : [];
      setRevisions(list);
      if (!filterRevisionId && list[0]) {
        const id = String(list[0].payRevisionId || list[0].id);
        setFilterRevisionId(id);
        setForm((prev) => ({ ...prev, payRevisionId: id }));
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to load pay revisions." });
    }
  };

  const loadMatrix = async (revisionId) => {
    if (!revisionId) {
      setRecords([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listPayMatrix(revisionId, false);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to load pay matrix." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRevisions();
  }, []);

  useEffect(() => {
    if (filterRevisionId) loadMatrix(filterRevisionId);
  }, [filterRevisionId]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setMessage({ type: "", text: "" });
  };

  const resetForm = () => {
    setForm({
      ...emptyForm(),
      payRevisionId: filterRevisionId || "",
    });
    setEditingId(null);
    setMessage({ type: "", text: "" });
  };

  const handleSave = async () => {
    const payRevisionId = Number(form.payRevisionId);
    const level = String(form.level || "")
      .replace(/\s+/g, " ")
      .trim();
    const cellNo = Number(form.cellNo);
    const basicPay = Number(form.basicPay);

    if (!Number.isFinite(payRevisionId)) {
      setMessage({ type: "error", text: "Pay Revision is required." });
      return;
    }
    if (!level || level.length > 50) {
      setMessage({ type: "error", text: "Level is required (e.g. IS-1)." });
      return;
    }
    if (!Number.isInteger(cellNo) || cellNo <= 0) {
      setMessage({ type: "error", text: "Cell No must be a valid positive number." });
      return;
    }
    if (!Number.isFinite(basicPay) || basicPay <= 0) {
      setMessage({ type: "error", text: "Basic Pay must be greater than 0." });
      return;
    }
    if (!form.effectiveDate) {
      setMessage({ type: "error", text: "Effective Date is required." });
      return;
    }

    const payload = {
      payRevisionId,
      level,
      cellNo,
      basicPay,
      effectiveDate: form.effectiveDate,
      payCommission: form.payCommission || null,
      status: form.status || "Active",
    };

    try {
      setLoading(true);
      if (editingId) {
        await updatePayMatrix(editingId, payload, user);
        setMessage({ type: "success", text: "Pay Matrix updated successfully." });
      } else {
        await createPayMatrix(payload, user);
        setMessage({ type: "success", text: "Pay Matrix saved successfully." });
      }
      resetForm();
      await loadMatrix(filterRevisionId || String(payRevisionId));
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to save pay matrix." });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (row) => {
    setForm({
      payRevisionId: String(row.payRevisionId || ""),
      level: String(row.level ?? ""),
      cellNo: String(row.cellNo ?? ""),
      basicPay: String(row.basicPay ?? ""),
      effectiveDate: toDateInput(row.effectiveDate),
      payCommission: row.payCommission || "7th CPC",
      status: row.status || "Active",
    });
    setEditingId(row.payMatrixId || row.id);
    setFilterRevisionId(String(row.payRevisionId || filterRevisionId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete Level ${row.level} / Cell ${row.cellNo}?`)) return;
    try {
      setLoading(true);
      await deletePayMatrix(row.payMatrixId || row.id, user);
      setMessage({ type: "success", text: "Pay Matrix row deleted." });
      if (editingId === (row.payMatrixId || row.id)) resetForm();
      await loadMatrix(filterRevisionId);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to delete." });
      await loadMatrix(filterRevisionId);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadPayMatrixTemplate();
      setMessage({ type: "success", text: "Template downloaded." });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to download template." });
    }
  };

  const handleImport = async () => {
    if (!filterRevisionId) {
      setMessage({
        type: "error",
        text: "Select a Pay Revision before importing.",
      });
      return;
    }
    if (!importFile) {
      setMessage({ type: "error", text: "Please choose an Excel file to import." });
      return;
    }
    try {
      setLoading(true);
      setImportResult(null);
      const result = await importPayMatrixExcel(
        importFile,
        user,
        filterRevisionId
      );
      setImportResult(result);
      setMessage({
        type: "success",
        text: result.message || "Import completed successfully.",
      });
      setImportFile(null);
      await loadMatrix(filterRevisionId);
    } catch (error) {
      const data = error.data || {};
      setImportResult({
        message: error.message || "Import failed.",
        summary: data.summary,
        errors: data.errors || [],
      });
      setMessage({ type: "error", text: error.message || "Import failed." });
    } finally {
      setLoading(false);
    }
  };

  const importErrorPreview = (() => {
    const list = Array.isArray(importResult?.errors) ? importResult.errors : [];
    if (!list.length) return [];
    /* Group identical field+message to avoid 120 identical Level errors */
    const groups = new Map();
    for (const err of list) {
      const key = `${err.field || ""}|${err.message || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          field: err.field || "",
          message: err.message || "",
          count: 0,
          samples: [],
        });
      }
      const g = groups.get(key);
      g.count += 1;
      if (g.samples.length < 5) {
        g.samples.push({
          row: err.row,
          value: err.value,
        });
      }
    }
    return Array.from(groups.values());
  })();

  return (
    <div className="section-master">
      <div className="sm-top">
        <button type="button" className="sm-back" onClick={onBack}>
          ← Back to Home
        </button>
        <h1>PAY MATRIX MASTER</h1>
      </div>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>EXCEL IMPORT</span>
          <span className="sm-crumb">Primary method for Pay Matrix data</span>
        </div>
        <div className="sm-card-body">
          <div className="sm-grid">
            <label>
              Pay Revision <em>*</em>
              <select
                value={filterRevisionId}
                onChange={(e) => {
                  setFilterRevisionId(e.target.value);
                  setForm((prev) => ({ ...prev, payRevisionId: e.target.value }));
                }}
                disabled={loading}
              >
                <option value="">Select Pay Revision for import</option>
                {revisions.map((r) => (
                  <option key={r.payRevisionId || r.id} value={r.payRevisionId || r.id}>
                    {r.revisionCode} — {r.revisionName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Choose Excel File
              <input
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={loading}
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] || null);
                  setImportResult(null);
                  setMessage({ type: "", text: "" });
                }}
              />
            </label>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#555" }}>
            Template columns: Level, CellNo, BasicPay, EffectiveDate. All rows
            import under the selected Pay Revision.
          </p>
          <div className="sm-actions">
            <button
              type="button"
              className="sm-btn primary"
              disabled={loading || !importFile || !filterRevisionId}
              onClick={handleImport}
            >
              Import Excel
            </button>
            <button
              type="button"
              className="sm-btn"
              disabled={loading}
              onClick={handleDownloadTemplate}
            >
              Download Excel Template
            </button>
          </div>
          {importResult ? (
            <div
              className={`sm-message ${
                importResult.errors?.length ? "is-error" : "is-success"
              }`}
              style={{ marginTop: 12 }}
            >
              <strong>Import Result</strong>
              <div style={{ marginTop: 4 }}>{importResult.message}</div>
              {importResult.summary ? (
                <div style={{ marginTop: 8, lineHeight: 1.6 }}>
                  <div>Total Rows: {importResult.summary.totalRows}</div>
                  <div>Valid: {importResult.summary.validRows}</div>
                  <div>Inserted: {importResult.summary.insertedRows}</div>
                  <div>Updated: {importResult.summary.updatedRows}</div>
                  <div>Failed: {importResult.summary.failedRows}</div>
                </div>
              ) : null}
              {importErrorPreview.length ? (
                <div style={{ marginTop: 10, overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>
                          Row
                        </th>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>
                          Field
                        </th>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>
                          Value
                        </th>
                        <th style={{ textAlign: "left", padding: "4px 6px" }}>
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {importErrorPreview.slice(0, 15).map((g) =>
                        g.samples.map((s) => (
                          <tr key={`${g.field}-${g.message}-${s.row}`}>
                            <td style={{ padding: "4px 6px" }}>{s.row}</td>
                            <td style={{ padding: "4px 6px" }}>{g.field}</td>
                            <td style={{ padding: "4px 6px" }}>
                              {s.value == null || s.value === ""
                                ? "(blank)"
                                : String(s.value)}
                            </td>
                            <td style={{ padding: "4px 6px" }}>
                              {g.message}
                              {g.count > 1
                                ? ` (${g.count} similar rows)`
                                : ""}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>{editingId ? "Edit Pay Matrix" : "PAY MATRIX INFORMATION"}</span>
          <Breadcrumb className="sm-crumb" section="Masters" current="Pay Matrix Master" />
        </div>
        <div className="sm-card-body">
          <div className="sm-grid">
            <label>
              Pay Revision <em>*</em>
              <select
                value={form.payRevisionId}
                onChange={(e) => {
                  handleChange("payRevisionId", e.target.value);
                  setFilterRevisionId(e.target.value);
                }}
                disabled={loading}
              >
                <option value="">Select</option>
                {revisions.map((r) => (
                  <option key={r.payRevisionId || r.id} value={r.payRevisionId || r.id}>
                    {r.revisionCode} — {r.revisionName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level <em>*</em>
              <input
                type="text"
                maxLength={50}
                placeholder="e.g. IS-1"
                value={form.level}
                onChange={(e) => handleChange("level", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Cell No <em>*</em>
              <input
                type="number"
                min="1"
                value={form.cellNo}
                onChange={(e) => handleChange("cellNo", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Basic Pay <em>*</em>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.basicPay}
                onChange={(e) => handleChange("basicPay", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Effective Date <em>*</em>
              <input
                type="date"
                value={form.effectiveDate}
                onChange={(e) => handleChange("effectiveDate", e.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              Status
              <select
                value={form.status}
                onChange={(e) => handleChange("status", e.target.value)}
                disabled={loading}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
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
          <span>PAY MATRIX LIST</span>
          <select
            value={filterRevisionId}
            onChange={(e) => setFilterRevisionId(e.target.value)}
            style={{ maxWidth: 280 }}
          >
            <option value="">Select Pay Revision</option>
            {revisions.map((r) => (
              <option key={r.payRevisionId || r.id} value={r.payRevisionId || r.id}>
                {r.revisionCode}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-card-body sm-list-body">
          <DataGrid
            title="Pay Matrix List"
            rows={records}
            emptyText={loading ? "Loading..." : "No pay matrix records found."}
            columns={[
              {
                key: "revisionCode",
                label: "Pay Revision",
                align: "center",
                getValue: (row) => row.revisionCode || row.payRevisionId,
              },
              { key: "level", label: "Level", align: "center" },
              { key: "cellNo", label: "Cell No", align: "center" },
              {
                key: "basicPay",
                label: "Basic Pay",
                align: "right",
                getValue: (row) =>
                  Number(row.basicPay || 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  }),
              },
              { key: "effectiveDate", label: "Effective Date", type: "date" },
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
