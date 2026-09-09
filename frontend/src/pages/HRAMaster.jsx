import { useCallback, useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import ModuleFrame from "../components/ModuleFrame";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  createHraMaster,
  deleteHraMaster,
  listHraCityClasses,
  listHraMaster,
  updateHraMaster,
} from "../utils/hraMasterApi";
import "./hraMaster.css";

const initialForm = {
  effectiveDate: "",
  cityClassId: "",
  cityClass: "",
  hraPercentage: "",
  description: "",
  status: "Active",
};

export default function HRAMaster({ onBack, user }) {
  const [form, setForm] = useState(initialForm);
  const [records, setRecords] = useState([]);
  const [cityClasses, setCityClasses] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState({
    effectiveDate: "",
    cityClass: "",
    status: "All",
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const setField = (field) => (e) => {
    const value = e.target.value;
    setForm((prev) => {
      if (field === "cityClassId") {
        const found = cityClasses.find(
          (c) => String(c.cityClassId) === String(value)
        );
        return {
          ...prev,
          cityClassId: value,
          cityClass: found?.cityClass || "",
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const setSearchField = (field) => (e) => {
    setSearch((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const loadRecords = useCallback(async (filters = {}) => {
    setLoading(true);
    try {
      const data = await listHraMaster(filters);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error.message || "Unable to load HRA Master.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const classes = await listHraCityClasses();
        setCityClasses(Array.isArray(classes) ? classes : []);
      } catch (error) {
        console.warn("City classes load failed:", error.message);
      }
      await loadRecords();
    })();
  }, [loadRecords]);

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setMessage("");
  };

  const resetSearch = async () => {
    const blank = { effectiveDate: "", cityClass: "", status: "All" };
    setSearch(blank);
    await loadRecords({});
  };

  const saveRecord = async () => {
    if (!form.effectiveDate || !form.cityClassId || form.hraPercentage === "") {
      setMessage("Please enter all required fields.");
      return;
    }
    const pct = Number(form.hraPercentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setMessage("HRA Percentage must be between 0 and 100.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        effectiveDate: form.effectiveDate,
        cityClassId: Number(form.cityClassId),
        cityClass: form.cityClass,
        hraPercentage: pct,
        description: form.description,
        status: form.status,
      };

      if (editingId) {
        const result = await updateHraMaster(editingId, payload, user);
        setMessage(result.message || "HRA Master updated successfully.");
      } else {
        const result = await createHraMaster(payload, user);
        setMessage(result.message || "HRA Master saved successfully.");
      }

      setForm(initialForm);
      setEditingId(null);
      await loadRecords(search);
    } catch (error) {
      setMessage(error.message || "Unable to save HRA Master.");
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    setMessage("");
    await loadRecords(search);
  };

  const filteredRecords = useMemo(() => records, [records]);

  const editRecord = (record) => {
    setForm({
      effectiveDate: record.effectiveDate || "",
      cityClassId: record.cityClassId != null ? String(record.cityClassId) : "",
      cityClass: record.cityClass || "",
      hraPercentage: record.hraPercentage ?? "",
      description: record.description || "",
      status: record.status || "Active",
    });
    setEditingId(record.id || record.hraId);
    setMessage("Record loaded for editing.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteRecord = async (id) => {
    if (
      !window.confirm(
        "Deactivate this HRA record? Historical rates are preserved as Inactive."
      )
    ) {
      return;
    }
    try {
      const result = await deleteHraMaster(id, user);
      setMessage(result.message || "HRA record deactivated.");
      if (editingId === id) resetForm();
      await loadRecords(search);
    } catch (error) {
      setMessage(error.message || "Unable to delete HRA Master.");
    }
  };

  return (
    <ModuleFrame title="HRA Master" onBack={onBack}>
      <div className="emp-master">
        <section className="hr-card">
          <div className="hr-card-head">
            <span>HRA INFORMATION</span>
            <Breadcrumb className="hr-crumb" section="Masters" current="HRA Master" />
          </div>

          <div className="hr-card-body">
            <div className="emp-grid">
              <label>
                <span className="hra-label-text">
                  Effective From Date <em>*</em>
                </span>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={setField("effectiveDate")}
                />
              </label>

              <label>
                <span className="hra-label-text">
                  City Class <em>*</em>
                </span>
                <select
                  value={form.cityClassId}
                  onChange={setField("cityClassId")}
                >
                  <option value="">Select City Class</option>
                  {cityClasses.map((c) => (
                    <option key={c.cityClassId} value={c.cityClassId}>
                      {c.cityClass}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="hra-label-text">
                  HRA Percentage <em>*</em>
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="Enter HRA Percentage"
                  value={form.hraPercentage}
                  onChange={setField("hraPercentage")}
                />
              </label>

              <label>
                Description
                <input
                  type="text"
                  placeholder="Enter Description"
                  value={form.description}
                  onChange={setField("description")}
                />
              </label>

              <label>
                <span className="hra-label-text">
                  Status <em>*</em>
                </span>
                <select value={form.status} onChange={setField("status")}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>

            <div className="hr-actions">
              {message && <div className="hr-msg">{message}</div>}
              <button
                type="button"
                className="btn primary"
                onClick={saveRecord}
                disabled={saving}
              >
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
              <button type="button" className="btn reset" onClick={resetForm}>
                Reset
              </button>
              <button type="button" className="btn" onClick={onBack}>
                Cancel
              </button>
            </div>
          </div>
        </section>

        <section className="hr-card">
          <div className="hr-card-head">
            <span>SEARCH HRA</span>
          </div>
          <div className="hr-card-body">
            <div
              className="search-row"
              style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}
            >
              <label>
                Effective Date
                <input
                  type="date"
                  value={search.effectiveDate}
                  onChange={setSearchField("effectiveDate")}
                />
              </label>
              <label>
                City Class
                <select
                  value={search.cityClass}
                  onChange={setSearchField("cityClass")}
                >
                  <option value="">All</option>
                  {cityClasses.map((c) => (
                    <option key={c.cityClassId} value={c.cityClass}>
                      {c.cityClass}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={search.status}
                  onChange={setSearchField("status")}
                >
                  <option value="All">All</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
              <div className="search-btns">
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleSearch}
                >
                  Search
                </button>
                <button
                  type="button"
                  className="btn reset"
                  onClick={resetSearch}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="hr-card">
          <div className="hr-card-head">
            <span>HRA LIST {loading ? "(Loading...)" : ""}</span>
          </div>
          <div className="hr-card-body">
            <DataGrid
              title="HRA List"
              rows={filteredRecords}
              emptyText="No HRA records found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                {
                  key: "effectiveDate",
                  label: "Effective Date",
                  type: "date",
                },
                {
                  key: "cityClass",
                  label: "City Class",
                  align: "center",
                },
                {
                  key: "hraPercentage",
                  label: "HRA Percentage",
                  align: "right",
                  getValue: (row) => `${row.hraPercentage}%`,
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
                      onEdit={() => editRecord(item)}
                      onDelete={() => deleteRecord(item.id)}
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
