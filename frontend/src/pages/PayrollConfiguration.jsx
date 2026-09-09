import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import {
  searchEmployeesForPayroll,
  getPayrollConfigByEmployee,
  listPayrollConfigs,
  savePayrollConfig,
  deactivatePayrollConfig,
} from "../utils/payrollConfigApi";
import "./payrollConfig.css";

const money = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const emptyConfig = () => ({
  id: null,
  medicalAllowanceApplicable: true,
  transportAllowanceApplicable: true,
  hraPreviousLocationApplicable: true,
  professionalTaxApplicable: false,
  nppaApplicable: "NA",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
});

function YesNoToggle({ value, onChange, disabled }) {
  return (
    <div className="pc-toggle-group">
      <button
        type="button"
        className={value ? "is-on" : ""}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        Yes
      </button>
      <button
        type="button"
        className={!value ? "is-on is-off" : "is-off"}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        No
      </button>
    </div>
  );
}

function NppaToggle({ value, onChange, disabled }) {
  const current = String(value || "NA").toUpperCase();
  return (
    <div className="pc-toggle-group">
      {["NA", "YES", "NO"].map((opt) => (
        <button
          key={opt}
          type="button"
          className={
            current === opt
              ? opt === "NA"
                ? "is-on is-na"
                : opt === "NO"
                  ? "is-on is-off"
                  : "is-on"
              : opt === "NA"
                ? "is-na"
                : opt === "NO"
                  ? "is-off"
                  : ""
          }
          disabled={disabled}
          onClick={() => onChange(opt)}
        >
          {opt === "NA" ? "N/A" : opt === "YES" ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

function yn(value) {
  return value ? "Yes" : "No";
}

export default function PayrollConfiguration({ onBack, user }) {
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [config, setConfig] = useState(emptyConfig());
  const [viewOnly, setViewOnly] = useState(false);
  const [records, setRecords] = useState([]);
  const [listFilters, setListFilters] = useState({
    employeeName: "",
    instituteCode: "",
    employeeType: "",
    status: "ALL",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const canEditInactive =
    String(user?.roleName || "")
      .toLowerCase()
      .includes("admin");

  const employeeInactive = useMemo(() => {
    if (!employee) return false;
    return (
      String(employee.status || "").toUpperCase() === "INACTIVE" ||
      employee.isActive === false
    );
  }, [employee]);

  const loadList = async (filters = listFilters) => {
    try {
      const data = await listPayrollConfigs(filters);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to load configuration list.",
      });
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchEmployees = async () => {
    setMessage({ type: "", text: "" });
    setSearching(true);
    try {
      const data = await searchEmployeesForPayroll(searchText.trim());
      setSearchResults(Array.isArray(data) ? data : []);
      if (!data?.length) {
        setMessage({ type: "error", text: "No employees found." });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Employee search failed.",
      });
    } finally {
      setSearching(false);
    }
  };

  const selectEmployee = async (row, mode = "edit") => {
    setMessage({ type: "", text: "" });
    setViewOnly(mode === "view");
    setLoading(true);
    try {
      const data = await getPayrollConfigByEmployee(row.employeeId);
      const emp = data?.employee || row;
      const cfg = data?.config || emptyConfig();

      if (
        (String(emp.status || "").toUpperCase() === "INACTIVE" ||
          emp.isActive === false) &&
        !canEditInactive &&
        mode !== "view"
      ) {
        setMessage({
          type: "error",
          text: "Cannot configure payroll for an inactive employee.",
        });
        setViewOnly(true);
      }

      setEmployee(emp);
      setConfig({
        id: cfg.id || null,
        medicalAllowanceApplicable: Boolean(cfg.medicalAllowanceApplicable),
        transportAllowanceApplicable: Boolean(cfg.transportAllowanceApplicable),
        hraPreviousLocationApplicable: Boolean(
          cfg.hraPreviousLocationApplicable
        ),
        professionalTaxApplicable: Boolean(cfg.professionalTaxApplicable),
        nppaApplicable: cfg.nppaApplicable || "NA",
        effectiveFrom: cfg.effectiveFrom
          ? String(cfg.effectiveFrom).slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        effectiveTo: cfg.effectiveTo
          ? String(cfg.effectiveTo).slice(0, 10)
          : "",
        isActive: cfg.isActive !== false,
      });
      setSearchResults([]);
      setSearchText(
        `${emp.employeeId} — ${emp.employeeCode || ""} ${emp.employeeName || ""}`.trim()
      );
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to load employee configuration.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setEmployee(null);
    setConfig(emptyConfig());
    setSearchText("");
    setSearchResults([]);
    setViewOnly(false);
    setMessage({ type: "", text: "" });
  };

  const handleSave = async () => {
    setMessage({ type: "", text: "" });
    if (!employee?.employeeId) {
      setMessage({ type: "error", text: "Please search and select an employee." });
      return;
    }
    if (employeeInactive && !canEditInactive) {
      setMessage({
        type: "error",
        text: "Cannot configure payroll for an inactive employee.",
      });
      return;
    }
    if (!config.effectiveFrom) {
      setMessage({ type: "error", text: "Effective From is required." });
      return;
    }
    if (
      config.effectiveTo &&
      config.effectiveTo < config.effectiveFrom
    ) {
      setMessage({
        type: "error",
        text: "Effective To cannot be earlier than Effective From.",
      });
      return;
    }

    setLoading(true);
    try {
      await savePayrollConfig(
        {
          id: config.id,
          employeeId: employee.employeeId,
          medicalAllowanceApplicable: config.medicalAllowanceApplicable,
          transportAllowanceApplicable: config.transportAllowanceApplicable,
          hraPreviousLocationApplicable: config.hraPreviousLocationApplicable,
          professionalTaxApplicable: config.professionalTaxApplicable,
          nppaApplicable: config.nppaApplicable,
          effectiveFrom: config.effectiveFrom,
          effectiveTo: config.effectiveTo || null,
          isActive: true,
        },
        user
      );
      setMessage({ type: "success", text: "Payroll configuration saved." });
      await loadList();
      await selectEmployee(employee, "edit");
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to save payroll configuration.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditRow = async (row) => {
    await selectEmployee(
      { employeeId: row.employeeId },
      "edit"
    );
    setConfig((prev) => ({
      ...prev,
      id: row.id,
    }));
  };

  const handleViewRow = async (row) => {
    await selectEmployee({ employeeId: row.employeeId }, "view");
  };

  const handleDeactivate = async (row) => {
    if (!window.confirm(`Deactivate payroll configuration for ${row.employeeName}?`)) {
      return;
    }
    try {
      await deactivatePayrollConfig(row.id, user);
      setMessage({ type: "success", text: "Configuration deactivated." });
      await loadList();
      if (config.id === row.id) {
        setConfig((prev) => ({ ...prev, isActive: false }));
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Unable to deactivate configuration.",
      });
    }
  };

  const formDisabled = viewOnly || loading;

  return (
    <div className="payroll-config">
      <div className="pc-top">
        <button type="button" className="pc-back" onClick={onBack}>
          ← Back
        </button>
        <h1>PAYROLL CONFIGURATION</h1>
      </div>

      <section className="pc-card">
        <div className="pc-card-head">
          <span>EMPLOYEE SEARCH</span>
          <Breadcrumb className="pc-crumb" section="Masters" current="Payroll Configuration" />
        </div>
        <div className="pc-card-body">
          <div className="pc-search-row">
            <label>
              <span>Employee ID / Employee Code / Name / Institute</span>
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearchEmployees();
                  }
                }}
                placeholder="Search employee"
              />
            </label>
            <button
              type="button"
              className="pc-btn pc-btn-primary"
              onClick={handleSearchEmployees}
              disabled={searching}
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {searchResults.length ? (
            <div className="pc-employee-results">
              {searchResults.map((row) => (
                <button
                  type="button"
                  key={row.employeeId}
                  className={
                    employee?.employeeId === row.employeeId ? "is-selected" : ""
                  }
                  onClick={() => selectEmployee(row)}
                >
                  {row.employeeId} | {row.employeeCode} | {row.employeeName} |{" "}
                  {row.instituteCode} | {row.employeeType} | {row.status}
                </button>
              ))}
            </div>
          ) : null}

          {message.text ? (
            <div className={`pc-msg ${message.type}`}>{message.text}</div>
          ) : null}
        </div>
      </section>

      {employee ? (
        <>
          <section className="pc-card">
            <div className="pc-card-head">
              <span>EMPLOYEE INFORMATION</span>
            </div>
            <div className="pc-card-body">
              <div className="pc-info-grid">
                <div>
                  <span>Employee Name</span>
                  <strong>{employee.employeeName || "-"}</strong>
                </div>
                <div>
                  <span>Designation</span>
                  <strong>{employee.designation || "-"}</strong>
                </div>
                <div>
                  <span>Employee Type</span>
                  <strong>{employee.employeeType || "-"}</strong>
                </div>
                <div>
                  <span>Institute Code</span>
                  <strong>{employee.instituteCode || "-"}</strong>
                </div>
                <div>
                  <span>Institute Name</span>
                  <strong>{employee.instituteName || "-"}</strong>
                </div>
                <div>
                  <span>District</span>
                  <strong>{employee.district || "-"}</strong>
                </div>
                <div>
                  <span>City Class</span>
                  <strong>{employee.cityClass || "-"}</strong>
                </div>
                <div>
                  <span>Pay Revision</span>
                  <strong>{employee.payRevision || "-"}</strong>
                </div>
                <div>
                  <span>Pay Level</span>
                  <strong>{employee.payLevel ?? "-"}</strong>
                </div>
                <div>
                  <span>Pay Matrix Cell</span>
                  <strong>{employee.payMatrixCell ?? "-"}</strong>
                </div>
                <div>
                  <span>Basic Pay</span>
                  <strong>{money(employee.basicPay)}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{employee.status || "-"}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className={`pc-card ${viewOnly ? "pc-view-only" : ""}`}>
            <div className="pc-card-head">
              <span>PAYROLL CONFIGURATION</span>
              {viewOnly ? <span className="pc-crumb">View only</span> : null}
            </div>
            <div className="pc-card-body">
              <div className="pc-config-grid">
                <div className="pc-config-row">
                  <span className="pc-field-label">Medical Allowance (MA)</span>
                  <YesNoToggle
                    value={config.medicalAllowanceApplicable}
                    disabled={formDisabled}
                    onChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        medicalAllowanceApplicable: v,
                      }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">Transport Allowance (TA)</span>
                  <YesNoToggle
                    value={config.transportAllowanceApplicable}
                    disabled={formDisabled}
                    onChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        transportAllowanceApplicable: v,
                      }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">
                    House Rent Allowance (HRA)
                  </span>
                  <YesNoToggle
                    value={config.hraPreviousLocationApplicable}
                    disabled={formDisabled}
                    onChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        hraPreviousLocationApplicable: v,
                      }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">Professional Tax</span>
                  <YesNoToggle
                    value={config.professionalTaxApplicable}
                    disabled={formDisabled}
                    onChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        professionalTaxApplicable: v,
                      }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">NPPA</span>
                  <NppaToggle
                    value={config.nppaApplicable}
                    disabled={formDisabled}
                    onChange={(v) =>
                      setConfig((prev) => ({ ...prev, nppaApplicable: v }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">Effective From *</span>
                  <input
                    type="date"
                    value={config.effectiveFrom}
                    disabled={formDisabled}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        effectiveFrom: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="pc-config-row">
                  <span className="pc-field-label">Effective To</span>
                  <input
                    type="date"
                    value={config.effectiveTo}
                    disabled={formDisabled}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        effectiveTo: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {!viewOnly ? (
                <div className="pc-actions">
                  <button
                    type="button"
                    className="pc-btn pc-btn-primary"
                    disabled={loading}
                    onClick={handleSave}
                  >
                    {loading ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="pc-btn"
                    disabled={loading}
                    onClick={handleReset}
                  >
                    Reset
                  </button>
                  <button type="button" className="pc-btn" onClick={onBack}>
                    Close
                  </button>
                </div>
              ) : (
                <div className="pc-actions">
                  <button
                    type="button"
                    className="pc-btn pc-btn-primary"
                    onClick={() => setViewOnly(false)}
                    disabled={employeeInactive && !canEditInactive}
                  >
                    Edit
                  </button>
                  <button type="button" className="pc-btn" onClick={handleReset}>
                    Reset
                  </button>
                  <button type="button" className="pc-btn" onClick={onBack}>
                    Close
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      <section className="pc-card">
        <div className="pc-card-head">
          <span>SEARCH PAYROLL CONFIGURATION</span>
        </div>
        <div className="pc-card-body">
          <div className="pc-filters">
            <label>
              <span>Employee Name / ID</span>
              <input
                value={listFilters.employeeName}
                onChange={(e) =>
                  setListFilters((prev) => ({
                    ...prev,
                    employeeName: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Institute</span>
              <input
                value={listFilters.instituteCode}
                onChange={(e) =>
                  setListFilters((prev) => ({
                    ...prev,
                    instituteCode: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Employee Type</span>
              <select
                value={listFilters.employeeType}
                onChange={(e) =>
                  setListFilters((prev) => ({
                    ...prev,
                    employeeType: e.target.value,
                  }))
                }
              >
                <option value="">All</option>
                <option value="REGULAR">REGULAR</option>
                <option value="FIX">FIX</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={listFilters.status}
                onChange={(e) =>
                  setListFilters((prev) => ({
                    ...prev,
                    status: e.target.value,
                  }))
                }
              >
                <option value="ALL">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
            <label>
              <span>&nbsp;</span>
              <button
                type="button"
                className="pc-btn pc-btn-primary"
                onClick={() => loadList(listFilters)}
              >
                Search
              </button>
            </label>
          </div>

          <DataGrid
            title="Payroll Configurations"
            rows={records}
            rowKey="id"
            defaultPageSize={10}
            columns={[
              {
                key: "employeeId",
                label: "Employee ID",
                width: 100,
                getValue: (row) => String(row.employeeId ?? ""),
              },
              {
                key: "employeeName",
                label: "Employee Name",
                width: 160,
              },
              {
                key: "designation",
                label: "Designation",
                width: 140,
              },
              {
                key: "employeeType",
                label: "Employee Type",
                width: 100,
              },
              {
                key: "instituteCode",
                label: "Institute Code",
                width: 110,
              },
              {
                key: "ma",
                label: "MA",
                width: 70,
                align: "center",
                getValue: (row) => yn(row.medicalAllowanceApplicable),
              },
              {
                key: "ta",
                label: "TA",
                width: 70,
                align: "center",
                getValue: (row) => yn(row.transportAllowanceApplicable),
              },
              {
                key: "hraPrev",
                label: "House Rent Allowance (HRA)",
                width: 160,
                align: "center",
                getValue: (row) => yn(row.hraPreviousLocationApplicable),
              },
              {
                key: "nppaApplicable",
                label: "NPPA",
                width: 80,
                align: "center",
                getValue: (row) =>
                  row.nppaApplicable === "NA"
                    ? "N/A"
                    : row.nppaApplicable || "N/A",
              },
              {
                key: "professionalTaxApplicable",
                label: "Professional Tax",
                width: 120,
                align: "center",
                getValue: (row) => yn(row.professionalTaxApplicable),
              },
              {
                key: "effectiveFrom",
                label: "Effective From",
                width: 120,
                getValue: (row) =>
                  row.effectiveFrom
                    ? String(row.effectiveFrom).slice(0, 10)
                    : "",
              },
              {
                key: "status",
                label: "Status",
                width: 90,
                type: "status",
                getValue: (row) => (row.isActive ? "Active" : "Inactive"),
              },
              {
                key: "actions",
                label: "Actions",
                type: "actions",
                width: 180,
                exportable: false,
                render: (row) => (
                  <GridActions
                    onEdit={() => handleEditRow(row)}
                    extra={
                      <>
                        <button
                          type="button"
                          className="dg-btn"
                          onClick={() => handleViewRow(row)}
                        >
                          View
                        </button>
                        {row.isActive ? (
                          <button
                            type="button"
                            className="dg-btn dg-btn-danger"
                            onClick={() => handleDeactivate(row)}
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </>
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
