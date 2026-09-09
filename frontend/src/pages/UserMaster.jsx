import { useCallback, useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { apiFetch } from "../utils/authSession";
import "./userMaster.css";
import { API_BASE_URL } from "../utils/apiConfig";

const API_URL = `${API_BASE_URL}/api/users`;
const ROLES_URL = `${API_BASE_URL}/api/roles`;

const EMPTY_FORM = {
  userName: "",
  fullName: "",
  email: "",
  password: "",
  confirmPassword: "",
  roleId: "",
  status: "Active",
};

export default function UserMaster({ onBack, user }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState({
    fullName: "",
    userName: "",
    roleId: "All",
    status: "All",
  });
  const [records, setRecords] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  /*
     Audit fields for the logged-in user.

     These MUST NOT be called userName / fullName here. The save payload
     carries the FORM's userName and fullName (the account being created or
     edited) and spreads the actor after them, so identically named actor
     keys silently overwrote the typed values: creating user "ao" while
     logged in as "admin" actually submitted userName "admin", which the
     backend correctly rejected as a duplicate.

     The backend's actorFromBody() already reads actorUserName /
     actorFullName, so the audit trail is unchanged.
  */
  const actor = {
    actorUserName: user?.userName || "SYSTEM",
    actorFullName: user?.fullName || user?.userName || "SYSTEM",
  };

  const loadRoles = useCallback(async () => {
    try {
      const res = await apiFetch(ROLES_URL);
      const data = await res.json();
      if (res.ok && data.success) setRoles(data.data || []);
    } catch (error) {
      console.warn("Roles load failed:", error.message);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      const res = await apiFetch(API_URL);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Unable to load users.");
      }
      setRecords(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      setRecords([]);
      const msg = error.message || "Unable to load users.";
      setLoadError(msg);
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
    loadUsers();
  }, [loadRoles, loadUsers]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSearchChange = (e) => {
    const { name, value } = e.target;
    setSearch((prev) => ({ ...prev, [name]: value }));
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setMessage("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.userName.trim()) {
      setMessage("Username is required.");
      return;
    }
    if (!form.fullName.trim()) {
      setMessage("Full Name is required.");
      return;
    }
    if (!form.roleId) {
      setMessage("Role is required.");
      return;
    }
    if (!editingId && !form.password) {
      setMessage("Password is required.");
      return;
    }
    if (form.password && form.password !== form.confirmPassword) {
      setMessage("Password and Confirm Password do not match.");
      return;
    }

    setSaving(true);
    try {
      /* Actor first, form fields last: the values the user typed always win. */
      const payload = {
        ...actor,
        userName: form.userName.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim() || null,
        roleId: Number(form.roleId),
        status: form.status,
      };
      if (form.password) payload.password = form.password;

      const res = await apiFetch(
        editingId != null ? `${API_URL}/${editingId}` : API_URL,
        {
          method: editingId != null ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Unable to save user.");
      }
      setMessage(data.message || "User saved successfully.");
      handleReset();
      await loadUsers();
    } catch (error) {
      setMessage(error.message || "Unable to save user.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row) => {
    setForm({
      userName: row.userName || "",
      fullName: row.fullName || "",
      email: row.email || "",
      password: "",
      confirmPassword: "",
      roleId: row.roleId != null ? String(row.roleId) : "",
      status: row.status || "Active",
    });
    setEditingId(row.userId || row.id);
    setMessage("Editing user. Leave password blank to keep existing password.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      const res = await apiFetch(`${API_URL}/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actor),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Unable to delete user.");
      }
      setMessage(data.message || "User deleted successfully.");
      if (editingId === id) handleReset();
      await loadUsers();
    } catch (error) {
      setMessage(error.message || "Unable to delete user.");
    }
  };

  const filtered = records.filter((row) => {
    const nameOk =
      !search.fullName ||
      String(row.fullName || "")
        .toLowerCase()
        .includes(search.fullName.toLowerCase());
    const userOk =
      !search.userName ||
      String(row.userName || "")
        .toLowerCase()
        .includes(search.userName.toLowerCase());
    const roleOk =
      search.roleId === "All" ||
      String(row.roleId) === String(search.roleId);
    const statusOk =
      search.status === "All" || row.status === search.status;
    return nameOk && userOk && roleOk && statusOk;
  });

  return (
    <div className="user-master">
      <div className="um-back">
        <button type="button" onClick={onBack}>
          ← Back
        </button>
      </div>

      <section className="um-card">
        <div className="um-card-head">
          <span>USER INFORMATION</span>
          <Breadcrumb className="um-crumb" section="Masters" current="User Master" />
        </div>
        <form className="um-card-body" onSubmit={handleSave}>
          <div className="um-grid">
            <label>
              Username <em>*</em>
              <input
                name="userName"
                value={form.userName}
                onChange={handleChange}
                autoComplete="off"
              />
            </label>
            <label>
              Full Name <em>*</em>
              <input
                name="fullName"
                value={form.fullName}
                onChange={handleChange}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
              />
            </label>
            <label>
              Password {editingId == null ? <em>*</em> : "(optional)"}
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm Password {editingId == null ? <em>*</em> : ""}
              <input
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                autoComplete="new-password"
              />
            </label>
            <label>
              Role <em>*</em>
              <select name="roleId" value={form.roleId} onChange={handleChange}>
                <option value="">Select Role</option>
                {roles.map((r) => (
                  <option key={r.roleId} value={r.roleId}>
                    {r.roleName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status <em>*</em>
              <select name="status" value={form.status} onChange={handleChange}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
          </div>
          {message ? <div className="um-message">{message}</div> : null}
          <div className="um-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving..." : editingId != null ? "Update" : "Save"}
            </button>
            <button type="button" className="btn" onClick={handleReset}>
              Reset
            </button>
            <button type="button" className="btn" onClick={onBack}>
              Cancel
            </button>
          </div>
        </form>
      </section>

      <section className="um-card">
        <div className="um-card-head">
          <span>SEARCH USER</span>
        </div>
        <div className="um-card-body">
          <div className="um-search-grid">
            <label>
              Full Name
              <input
                name="fullName"
                value={search.fullName}
                onChange={handleSearchChange}
              />
            </label>
            <label>
              Username
              <input
                name="userName"
                value={search.userName}
                onChange={handleSearchChange}
              />
            </label>
            <label>
              Role
              <select
                name="roleId"
                value={search.roleId}
                onChange={handleSearchChange}
              >
                <option value="All">All</option>
                {roles.map((r) => (
                  <option key={r.roleId} value={r.roleId}>
                    {r.roleName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                name="status"
                value={search.status}
                onChange={handleSearchChange}
              >
                <option value="All">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="um-card">
        <div className="um-card-head">
          <span>USER LIST {loading ? "(Loading users...)" : ""}</span>
        </div>
        <div className="um-card-body">
          {loadError ? (
            <div className="um-message" role="alert">
              {loadError}{" "}
              <button type="button" className="btn" onClick={loadUsers}>
                Retry
              </button>
            </div>
          ) : null}
          {loading && !filtered.length ? (
            <div className="um-message">Loading users...</div>
          ) : (
            <DataGrid
              title="User List"
              rows={filtered}
              emptyText="No users found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                { key: "userName", label: "Username" },
                { key: "fullName", label: "Full Name", align: "left" },
                { key: "email", label: "Email", align: "left" },
                { key: "roleName", label: "Role", align: "center" },
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
                      onDelete={() => handleDelete(row.userId || row.id)}
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
