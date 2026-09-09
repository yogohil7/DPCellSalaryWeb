import { useEffect, useMemo, useState } from "react";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  listSalaryComponents,
  updateSalaryComponent,
  listSalaryComponentRules,
  createSalaryComponentRule,
  updateSalaryComponentRule,
  deleteSalaryComponentRule,
} from "../utils/salaryComponentApi";
import { listActivePayRevisions } from "../utils/payRevisionApi";
import { listEmployees } from "../utils/employeeApi";
import "./sectionMaster.css";

const emptyRule = () => ({
  salaryComponentId: "",
  payRevisionId: "",
  cityClassId: "",
  designationId: "",
  employeeClass: "",
  employeeId: "",
  effectiveFrom: "",
  effectiveTo: "",
  percentage: "",
  fixedAmount: "",
  formula: "",
  isActive: true,
});

export default function SalaryComponentMaster({ onBack, user }) {
  const [components, setComponents] = useState([]);
  const [rules, setRules] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [editingComponentId, setEditingComponentId] = useState(null);
  const [componentForm, setComponentForm] = useState(null);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [comps, ruleRows, revs, employeeRows] = await Promise.all([
        listSalaryComponents(false),
        listSalaryComponentRules(),
        listActivePayRevisions(),
        listEmployees(),
      ]);
      setComponents(Array.isArray(comps) ? comps : []);
      setRules(Array.isArray(ruleRows) ? ruleRows : []);
      setRevisions(Array.isArray(revs) ? revs : []);
      setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to load components." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLowerCase();
    if (!search) return employees;
    return employees.filter((employee) =>
      [employee.employeeId, employee.employeeCode, employee.employeeName]
        .some((value) => String(value || "").toLowerCase().includes(search))
    );
  }, [employees, employeeSearch]);

  const saveComponent = async () => {
    if (!componentForm?.componentName?.trim()) {
      setMessage({ type: "error", text: "Component Name is required." });
      return;
    }
    try {
      setLoading(true);
      await updateSalaryComponent(editingComponentId, componentForm, user);
      setMessage({ type: "success", text: "Component updated." });
      setEditingComponentId(null);
      setComponentForm(null);
      await loadAll();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to update component." });
    } finally {
      setLoading(false);
    }
  };

  const saveRule = async () => {
    if (!ruleForm.salaryComponentId) {
      setMessage({ type: "error", text: "Select a salary component." });
      return;
    }
    if (!ruleForm.effectiveFrom) {
      setMessage({ type: "error", text: "Effective From is required." });
      return;
    }
    const payload = {
      salaryComponentId: Number(ruleForm.salaryComponentId),
      payRevisionId: ruleForm.payRevisionId || null,
      cityClassId: ruleForm.cityClassId || null,
      designationId: ruleForm.designationId || null,
      employeeClass: ruleForm.employeeClass || null,
      employeeId: ruleForm.employeeId || null,
      effectiveFrom: ruleForm.effectiveFrom,
      effectiveTo: ruleForm.effectiveTo || null,
      percentage: ruleForm.percentage === "" ? null : Number(ruleForm.percentage),
      fixedAmount: ruleForm.fixedAmount === "" ? null : Number(ruleForm.fixedAmount),
      formula: ruleForm.formula || null,
      isActive: !!ruleForm.isActive,
    };
    try {
      setLoading(true);
      if (editingRuleId) {
        await updateSalaryComponentRule(editingRuleId, payload, user);
        setMessage({ type: "success", text: "Rule updated." });
      } else {
        await createSalaryComponentRule(payload, user);
        setMessage({ type: "success", text: "Rule saved." });
      }
      setRuleForm(emptyRule());
      setEditingRuleId(null);
      await loadAll();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to save rule." });
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
        <h1>SALARY COMPONENT MASTER</h1>
      </div>

      {message.text ? (
        <div className={`sm-message ${message.type === "error" ? "is-error" : "is-success"}`}>
          {message.text}
        </div>
      ) : null}

      {componentForm ? (
        <section className="sm-card">
          <div className="sm-card-head">
            <span>Edit Component ({componentForm.componentCode})</span>
          </div>
          <div className="sm-card-body">
            <div className="sm-grid">
              <label>
                Component Name
                <input
                  value={componentForm.componentName}
                  onChange={(e) =>
                    setComponentForm((p) => ({ ...p, componentName: e.target.value }))
                  }
                />
              </label>
              <label>
                Component Type
                <input
                  value={componentForm.componentType}
                  onChange={(e) =>
                    setComponentForm((p) => ({ ...p, componentType: e.target.value }))
                  }
                />
              </label>
              <label>
                Rule Source
                <input
                  value={componentForm.ruleSource || ""}
                  onChange={(e) =>
                    setComponentForm((p) => ({ ...p, ruleSource: e.target.value }))
                  }
                />
              </label>
              <label>
                Display Order
                <input
                  type="number"
                  value={componentForm.displayOrder ?? ""}
                  onChange={(e) =>
                    setComponentForm((p) => ({ ...p, displayOrder: e.target.value }))
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={componentForm.isActive ? "1" : "0"}
                  onChange={(e) =>
                    setComponentForm((p) => ({ ...p, isActive: e.target.value === "1" }))
                  }
                >
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </label>
            </div>
            <div className="sm-actions">
              <button type="button" className="sm-btn primary" onClick={saveComponent}>
                Update
              </button>
              <button
                type="button"
                className="sm-btn reset"
                onClick={() => {
                  setComponentForm(null);
                  setEditingComponentId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sm-card">
        <div className="sm-card-head">
          <span>COMPONENTS</span>
        </div>
        <div className="sm-card-body sm-list-body">
          <DataGrid
            title="Salary Components"
            rows={components}
            emptyText={loading ? "Loading..." : "No components found."}
            columns={[
              { key: "componentCode", label: "Code", align: "center" },
              { key: "componentName", label: "Name", align: "left" },
              { key: "componentType", label: "Type", align: "center" },
              { key: "ruleSource", label: "Rule Source", align: "left" },
              { key: "displayOrder", label: "Order", align: "center" },
              {
                key: "status",
                label: "Status",
                type: "status",
                getValue: (row) => (row.isActive ? "Active" : "Inactive"),
              },
              {
                key: "actions",
                label: "Actions",
                type: "actions",
                sortable: false,
                exportable: false,
                render: (row) => (
                  <GridActions
                    onEdit={() => {
                      setEditingComponentId(row.salaryComponentId || row.id);
                      setComponentForm({
                        componentCode: row.componentCode,
                        componentName: row.componentName,
                        componentType: row.componentType,
                        calculationType: row.calculationType,
                        ruleSource: row.ruleSource,
                        displayOrder: row.displayOrder,
                        isActive: row.isActive,
                      });
                    }}
                  />
                ),
              },
            ]}
          />
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>{editingRuleId ? "Edit Rule" : "SALARY COMPONENT RULE"}</span>
        </div>
        <div className="sm-card-body">
          <div className="sm-grid">
            <label>
              Component <em>*</em>
              <select
                value={ruleForm.salaryComponentId}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, salaryComponentId: e.target.value }))
                }
              >
                <option value="">Select</option>
                {components.map((c) => (
                  <option key={c.salaryComponentId} value={c.salaryComponentId}>
                    {c.componentCode} — {c.componentName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pay Revision
              <select
                value={ruleForm.payRevisionId}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, payRevisionId: e.target.value }))
                }
              >
                <option value="">Any</option>
                {revisions.map((r) => (
                  <option key={r.payRevisionId} value={r.payRevisionId}>
                    {r.revisionCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search Employee ID / Name
              <input
                type="search"
                placeholder="Type employee ID, code, or name"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
              />
            </label>
            <label>
              Employee Override
              <select
                value={ruleForm.employeeId}
                onChange={(e) => setRuleForm((p) => ({ ...p, employeeId: e.target.value }))}
              >
                <option value="">All employees (general rule)</option>
                {filteredEmployees.map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    ID {employee.employeeId} — {employee.employeeCode || "No code"} — {employee.employeeName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effective From <em>*</em>
              <input
                type="date"
                value={ruleForm.effectiveFrom}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, effectiveFrom: e.target.value }))
                }
              />
            </label>
            <label>
              Effective To
              <input
                type="date"
                value={ruleForm.effectiveTo}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, effectiveTo: e.target.value }))
                }
              />
            </label>
            <label>
              Percentage
              <input
                type="number"
                step="0.0001"
                value={ruleForm.percentage}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, percentage: e.target.value }))
                }
              />
            </label>
            <label>
              Fixed Amount
              <input
                type="number"
                step="0.01"
                value={ruleForm.fixedAmount}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, fixedAmount: e.target.value }))
                }
              />
            </label>
            <label>
              Formula
              <input
                value={ruleForm.formula}
                onChange={(e) => setRuleForm((p) => ({ ...p, formula: e.target.value }))}
              />
            </label>
            <label>
              Employee Class
              <input
                value={ruleForm.employeeClass}
                onChange={(e) =>
                  setRuleForm((p) => ({ ...p, employeeClass: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="sm-actions">
            <button type="button" className="sm-btn primary" onClick={saveRule} disabled={loading}>
              {editingRuleId ? "Update Rule" : "Save Rule"}
            </button>
            <button
              type="button"
              className="sm-btn reset"
              onClick={() => {
                setRuleForm(emptyRule());
                setEditingRuleId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <span>RULE LIST</span>
        </div>
        <div className="sm-card-body sm-list-body">
          <DataGrid
            title="Component Rules"
            rows={rules}
            emptyText="No rules found."
            columns={[
              { key: "componentCode", label: "Component", align: "center" },
              { key: "revisionCode", label: "Pay Revision", align: "center" },
              { key: "employeeName", label: "Employee Override", align: "left" },
              { key: "effectiveFrom", label: "From", type: "date" },
              { key: "effectiveTo", label: "To", type: "date" },
              { key: "percentage", label: "%", align: "right" },
              { key: "fixedAmount", label: "Fixed", align: "right" },
              {
                key: "status",
                label: "Status",
                type: "status",
                getValue: (row) => (row.isActive ? "Active" : "Inactive"),
              },
              {
                key: "actions",
                label: "Actions",
                type: "actions",
                sortable: false,
                exportable: false,
                render: (row) => (
                  <GridActions
                    onEdit={() => {
                      setEditingRuleId(row.salaryComponentRuleId || row.id);
                      setRuleForm({
                        salaryComponentId: String(row.salaryComponentId || ""),
                        payRevisionId: row.payRevisionId ? String(row.payRevisionId) : "",
                        cityClassId: row.cityClassId ? String(row.cityClassId) : "",
                        designationId: row.designationId ? String(row.designationId) : "",
                        employeeClass: row.employeeClass || "",
                        employeeId: row.employeeId ? String(row.employeeId) : "",
                        effectiveFrom: row.effectiveFrom
                          ? String(row.effectiveFrom).slice(0, 10)
                          : "",
                        effectiveTo: row.effectiveTo
                          ? String(row.effectiveTo).slice(0, 10)
                          : "",
                        percentage: row.percentage ?? "",
                        fixedAmount: row.fixedAmount ?? "",
                        formula: row.formula || "",
                        isActive: row.isActive,
                      });
                    }}
                    onDelete={async () => {
                      if (!window.confirm("Deactivate this rule?")) return;
                      await deleteSalaryComponentRule(
                        row.salaryComponentRuleId || row.id,
                        user
                      );
                      await loadAll();
                    }}
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
