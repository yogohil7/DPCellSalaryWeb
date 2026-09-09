import { useCallback, useEffect, useMemo, useState } from "react";
import ModuleFrame from "../components/ModuleFrame";
import DataGrid, { GridActions } from "../components/DataGrid";
import { apiFetch } from "../utils/authSession";
import "./rolePermissionMaster.css";
import { API_BASE_URL } from "../utils/apiConfig";

const ACTIONS = ["VIEW", "ADD", "EDIT", "DELETE", "EXPORT"];

const API_ROLES = `${API_BASE_URL}/api/roles`;

function actionFromCode(code) {
  const upper = String(code || "").toUpperCase();
  for (const a of ACTIONS) {
    if (upper.endsWith(`_${a}`)) return a;
  }
  return null;
}

function pageKeyFromCode(code) {
  const upper = String(code || "").toUpperCase();
  for (const a of ACTIONS) {
    if (upper.endsWith(`_${a}`)) {
      return upper.slice(0, -(a.length + 1));
    }
  }
  return upper;
}

function pageLabelFromName(permissionName, pageKey) {
  const raw = String(permissionName || "");
  const before = raw.split(" - ")[0]?.trim();
  return before || pageKey.replace(/_/g, " ");
}

export default function RolePermissionMaster({ onBack, user }) {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState({
    roleId: null,
    roleName: "",
    description: "",
    status: "Active",
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const actor = {
    userName: user?.userName || "SYSTEM",
    fullName: user?.fullName || user?.userName || "SYSTEM",
  };

  const loadCatalog = useCallback(async () => {
    const res = await apiFetch(`${API_ROLES}/permissions/catalog`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Unable to load permissions.");
    }
    setCatalog(Array.isArray(data.data) ? data.data : []);
  }, []);

  const loadRoles = useCallback(async () => {
    const res = await apiFetch(API_ROLES);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || "Unable to load roles.");
    }
    setRoles(Array.isArray(data.data) ? data.data : []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadCatalog(), loadRoles()]);
      } catch (error) {
        setMessage(error.message || "Unable to load role/permission data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCatalog, loadRoles]);

  const pagesByModule = useMemo(() => {
    const modules = new Map();
    for (const p of catalog) {
      const moduleName = p.moduleName || "Other";
      const pageKey = pageKeyFromCode(p.permissionCode);
      const action = actionFromCode(p.permissionCode);
      if (!action) continue;
      if (!modules.has(moduleName)) modules.set(moduleName, new Map());
      const pages = modules.get(moduleName);
      if (!pages.has(pageKey)) {
        pages.set(pageKey, {
          pageKey,
          label: pageLabelFromName(p.permissionName, pageKey),
          actions: {},
        });
      }
      pages.get(pageKey).actions[action] = p;
    }
    return Array.from(modules.entries()).map(([moduleName, pages]) => ({
      moduleName,
      pages: Array.from(pages.values()),
    }));
  }, [catalog]);

  const newRole = () => {
    setForm({ roleId: null, roleName: "", description: "", status: "Active" });
    setSelectedIds(new Set());
    setMessage("");
  };

  const editRole = async (role) => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API_ROLES}/${role.roleId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Unable to load role.");
      }
      const detail = data.data;
      setForm({
        roleId: detail.roleId,
        roleName: detail.roleName || "",
        description: detail.description || "",
        status: detail.status || "Active",
      });
      setSelectedIds(new Set(detail.permissionIds || []));
      setMessage(`Editing ${detail.roleName}.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(error.message || "Unable to load role.");
    } finally {
      setLoading(false);
    }
  };

  const togglePermission = (permissionId, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permissionId);
      else next.delete(permissionId);
      return next;
    });
  };

  const togglePageAll = (page, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const a of ACTIONS) {
        const perm = page.actions[a];
        if (!perm) continue;
        if (checked) next.add(perm.permissionId);
        else next.delete(perm.permissionId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.roleName.trim()) {
      setMessage("Role Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        roleName: form.roleName.trim(),
        description: form.description.trim(),
        status: form.status,
        permissionIds: Array.from(selectedIds),
        ...actor,
      };
      const res = await apiFetch(
        form.roleId != null ? `${API_ROLES}/${form.roleId}` : API_ROLES,
        {
          method: form.roleId != null ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Unable to save role permissions.");
      }
      setMessage(data.message || "Role permissions saved successfully.");
      await loadRoles();
      if (data.data?.roleId) {
        setForm((prev) => ({ ...prev, roleId: data.data.roleId }));
      }
    } catch (error) {
      setMessage(error.message || "Unable to save role permissions.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (!window.confirm(`Delete role "${role.roleName}"?`)) return;
    try {
      const res = await apiFetch(`${API_ROLES}/${role.roleId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actor),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Unable to delete role.");
      }
      setMessage(data.message || "Role deleted successfully.");
      if (form.roleId === role.roleId) newRole();
      await loadRoles();
    } catch (error) {
      setMessage(error.message || "Unable to delete role.");
    }
  };

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) =>
      [r.roleName, r.description, r.status]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [roles, search]);

  return (
    <ModuleFrame title="ROLE & PERMISSION MASTER" onBack={onBack}>
      <div className="rp-master">
        {message ? <div className="rp-message">{message}</div> : null}

        <section className="rp-card">
          <div className="rp-card-head">ROLE INFORMATION</div>
          <div className="rp-card-body">
            <div className="rp-role-grid">
              <label>
                Role Name <em>*</em>
                <input
                  value={form.roleName}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, roleName: e.target.value }))
                  }
                  placeholder="Enter role name"
                />
              </label>
              <label>
                Description
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Enter description"
                />
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, status: e.target.value }))
                  }
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>
            <div className="rp-actions">
              <button type="button" className="btn primary" onClick={newRole}>
                New Role
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleSave}
                disabled={saving || loading}
              >
                {saving ? "Saving..." : "Save Permissions"}
              </button>
              <button type="button" className="btn" onClick={onBack}>
                Cancel
              </button>
            </div>
          </div>
        </section>

        <section className="rp-card">
          <div className="rp-card-head">
            PERMISSIONS {loading ? "(Loading...)" : ""}
          </div>
          <div className="rp-card-body">
            {pagesByModule.map((mod) => (
              <div key={mod.moduleName} className="rp-module-block">
                <h4 className="rp-module-title">{mod.moduleName}</h4>
                <table className="rp-perm-table">
                  <thead>
                    <tr>
                      <th>Page</th>
                      {ACTIONS.map((a) => (
                        <th key={a}>{a.charAt(0) + a.slice(1).toLowerCase()}</th>
                      ))}
                      <th>All</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mod.pages.map((page) => {
                      const allChecked = ACTIONS.every((a) => {
                        const p = page.actions[a];
                        return !p || selectedIds.has(p.permissionId);
                      });
                      return (
                        <tr key={page.pageKey}>
                          <td>{page.label}</td>
                          {ACTIONS.map((a) => {
                            const perm = page.actions[a];
                            if (!perm) {
                              return <td key={a}>-</td>;
                            }
                            return (
                              <td key={a}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(perm.permissionId)}
                                  onChange={(e) =>
                                    togglePermission(
                                      perm.permissionId,
                                      e.target.checked
                                    )
                                  }
                                />
                              </td>
                            );
                          })}
                          <td>
                            <input
                              type="checkbox"
                              checked={allChecked}
                              onChange={(e) =>
                                togglePageAll(page, e.target.checked)
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>

        <section className="rp-card">
          <div className="rp-card-head">ROLE LIST</div>
          <div className="rp-card-body">
            <input
              className="rp-search"
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <DataGrid
              title="Roles"
              rows={filteredRoles}
              emptyText="No role records found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                { key: "roleName", label: "Role Name", align: "left" },
                { key: "description", label: "Description", align: "left" },
                { key: "status", label: "Status", type: "status" },
                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,
                  render: (role) => (
                    <GridActions
                      onEdit={() => editRole(role)}
                      onDelete={() => handleDelete(role)}
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
