import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import ModuleFrame from "../components/ModuleFrame";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  listAllDesignations,
  createDesignation,
  updateDesignation,
  deleteDesignation,
} from "../utils/designationApi";
import "./DesignationMaster.css";

const initialForm = {
  designationCode: "",
  designationName: "",
  designationType: "",
  employeeClass: "",
  status: "Active",
};

const initialSearch = {
  designationCode: "",
  designationName: "",
  designationType: "All",
  employeeClass: "All",
  status: "All",
};

export default function DesignationMaster({ onBack, user }) {
  const [form, setForm] = useState(initialForm);
  const [designations, setDesignations] = useState([]);
  const [search, setSearch] = useState(initialSearch);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadDesignations = async () => {
    setLoading(true);
    try {
      const data = await listAllDesignations();
      setDesignations(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error.message || "Unable to load designations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDesignations();
  }, []);

  const setField = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
    setMessage("");
  };

  const setSearchField = (field) => (event) => {
    setSearch((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setMessage("");

    if (!form.designationCode.trim()) {
      setMessage("Please enter Designation Code.");
      return;
    }
    if (!form.designationName.trim()) {
      setMessage("Please enter Designation Name.");
      return;
    }
    if (!form.designationType) {
      setMessage("Please select Designation Type.");
      return;
    }
    if (!form.employeeClass) {
      setMessage("Please select Employee Class.");
      return;
    }
    if (!form.status) {
      setMessage("Please select Status.");
      return;
    }

    const payload = {
      designationCode: form.designationCode.trim().toUpperCase(),
      designationName: form.designationName.trim(),
      designationType: form.designationType,
      employeeClass: form.employeeClass,
      status: form.status,
    };

    try {
      setLoading(true);
      if (editingId != null) {
        await updateDesignation(editingId, payload, user);
        setMessage("Designation updated successfully.");
      } else {
        await createDesignation(payload, user);
        setMessage("Designation saved successfully.");
      }
      setEditingId(null);
      setForm(initialForm);
      await loadDesignations();
    } catch (error) {
      setMessage(error.message || "Unable to save designation.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm(initialForm);
    setEditingId(null);
    setMessage("");
  };

  const handleCancel = () => {
    setForm(initialForm);
    setEditingId(null);
    setMessage("");
    onBack();
  };

  const handleEdit = (item) => {
    setForm({
      designationCode: item.designationCode || "",
      designationName: item.designationName || "",
      designationType: item.designationType || "",
      employeeClass: item.employeeClass || "",
      status: item.status || "Active",
    });
    setEditingId(item.designationId || item.id);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (item) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this designation?"
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      await deleteDesignation(item.designationId || item.id, user);
      setMessage("Designation deleted successfully.");
      if (editingId === (item.designationId || item.id)) {
        setForm(initialForm);
        setEditingId(null);
      }
      await loadDesignations();
    } catch (error) {
      setMessage(error.message || "Unable to delete designation.");
    } finally {
      setLoading(false);
    }
  };

  const filteredDesignations = designations.filter((item) => {
    const codeMatch =
      !search.designationCode ||
      item.designationCode
        .toLowerCase()
        .includes(search.designationCode.toLowerCase());

    const nameMatch =
      !search.designationName ||
      item.designationName
        .toLowerCase()
        .includes(search.designationName.toLowerCase());

    const typeMatch =
      search.designationType === "All" ||
      item.designationType === search.designationType;

    const classMatch =
      search.employeeClass === "All" ||
      item.employeeClass === search.employeeClass;

    const statusMatch =
      search.status === "All" || item.status === search.status;

    return codeMatch && nameMatch && typeMatch && classMatch && statusMatch;
  });

  const handleSearchReset = () => {
    setSearch(initialSearch);
  };

  return (
    <ModuleFrame title="DESIGNATION MASTER" onBack={onBack}>
      <div className="designation-master">
        <div className="designation-card">
          <div className="designation-card-head">
            <span>DESIGNATION INFORMATION</span>
            <span className="designation-crumb">
              <Breadcrumb className="designation-crumb" section="Masters" current="Designation Master" />
            </span>
          </div>

          <div className="designation-card-body">
            <form onSubmit={handleSave}>
              <div className="designation-grid">
                <label>
                  Designation Code <em>*</em>
                  <input
                    type="text"
                    placeholder="Enter Designation Code"
                    value={form.designationCode}
                    onChange={setField("designationCode")}
                    disabled={loading}
                  />
                </label>

                <label>
                  Designation Name <em>*</em>
                  <input
                    type="text"
                    placeholder="Enter Designation Name"
                    value={form.designationName}
                    onChange={setField("designationName")}
                    disabled={loading}
                  />
                </label>

                <label>
                  Designation Type <em>*</em>
                  <select
                    value={form.designationType}
                    onChange={setField("designationType")}
                    disabled={loading}
                  >
                    <option value="">Select Designation Type</option>
                    <option value="Teaching">Teaching</option>
                    <option value="Non Teaching">Non Teaching</option>
                  </select>
                </label>

                <label>
                  Employee Class <em>*</em>
                  <select
                    value={form.employeeClass}
                    onChange={setField("employeeClass")}
                    disabled={loading}
                  >
                    <option value="">Select Employee Class</option>
                    <option value="Class 3">Class 3</option>
                    <option value="Class 4">Class 4</option>
                  </select>
                </label>

                <label>
                  Status <em>*</em>
                  <select
                    value={form.status}
                    onChange={setField("status")}
                    disabled={loading}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <div className="designation-actions">
                {message && (
                  <div className="designation-message">{message}</div>
                )}

                <button
                  type="submit"
                  className="d-btn d-primary"
                  disabled={loading}
                >
                  {editingId != null ? "Update" : "Save"}
                </button>

                <button
                  type="button"
                  className="d-btn d-reset"
                  onClick={handleReset}
                  disabled={loading}
                >
                  Reset
                </button>

                <button
                  type="button"
                  className="d-btn d-cancel"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="designation-card">
          <div className="designation-card-head">
            <span>SEARCH DESIGNATION</span>
          </div>

          <div className="designation-card-body">
            <div className="designation-search-grid">
              <label>
                Designation Code
                <input
                  type="text"
                  placeholder="Designation Code"
                  value={search.designationCode}
                  onChange={setSearchField("designationCode")}
                />
              </label>

              <label>
                Designation Name
                <input
                  type="text"
                  placeholder="Designation Name"
                  value={search.designationName}
                  onChange={setSearchField("designationName")}
                />
              </label>

              <label>
                Designation Type
                <select
                  value={search.designationType}
                  onChange={setSearchField("designationType")}
                >
                  <option value="All">All</option>
                  <option value="Teaching">Teaching</option>
                  <option value="Non Teaching">Non Teaching</option>
                </select>
              </label>

              <label>
                Employee Class
                <select
                  value={search.employeeClass}
                  onChange={setSearchField("employeeClass")}
                >
                  <option value="All">All</option>
                  <option value="Class 3">Class 3</option>
                  <option value="Class 4">Class 4</option>
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

              <div className="designation-search-buttons">
                <button type="button" className="d-btn d-primary">
                  Search
                </button>
                <button
                  type="button"
                  className="d-btn d-reset"
                  onClick={handleSearchReset}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="designation-card">
          <div className="designation-card-head">
            <span>DESIGNATION LIST</span>
          </div>

          <div className="designation-list-body">
            <DataGrid
              title="Designation List"
              rows={filteredDesignations}
              emptyText={
                loading
                  ? "Loading designations..."
                  : "No designation records found."
              }
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                {
                  key: "designationCode",
                  label: "Designation Code",
                  align: "center",
                },
                {
                  key: "designationName",
                  label: "Designation Name",
                  align: "left",
                },
                {
                  key: "designationType",
                  label: "Designation Type",
                  align: "left",
                },
                {
                  key: "employeeClass",
                  label: "Employee Class",
                  align: "center",
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
                      onDelete={() => handleDelete(item)}
                    />
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
    </ModuleFrame>
  );
}
