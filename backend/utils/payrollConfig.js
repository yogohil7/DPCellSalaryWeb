const { sql } = require("../db");
const { normalizeEmployeeType } = require("./employeePayRules");

/** Defaults when no EmployeePayrollConfiguration exists.
 *  New employees: HRA/MA/TA = YES (calculate). Explicit saved
 *  configs override these defaults.
 */
function defaultPayrollConfig() {
  return {
    id: null,
    employeeId: null,
    medicalAllowanceApplicable: true,
    transportAllowanceApplicable: true,
    /* Column name is historical; UI label is House Rent Allowance (HRA).
       true  = HRA YES → calculate from HRAMaster
       false = HRA NO  → force HRA amount to 0 */
    hraPreviousLocationApplicable: true,
    professionalTaxApplicable: false,
    nppaApplicable: "NA",
    effectiveFrom: null,
    effectiveTo: null,
    isActive: false,
    isDefault: true,
  };
}

function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "YES";
}

/** HRA YES/NO from payroll config. Default is YES (calculate). */
function isHraApplicable(config) {
  if (!config) return true;
  return toBool(config.hraPreviousLocationApplicable);
}

/** When true, Salary Entry must set HRA amount to 0. */
function isHraForcedZero(config) {
  return !isHraApplicable(config);
}

function normalizeNppa(value) {
  const raw = String(value == null ? "NA" : value)
    .trim()
    .toUpperCase();
  if (raw === "YES" || raw === "Y" || raw === "1" || raw === "TRUE") return "YES";
  if (raw === "NO" || raw === "N" || raw === "0" || raw === "FALSE") return "NO";
  return "NA";
}

function mapConfigRow(row) {
  if (!row) return defaultPayrollConfig();
  return {
    id: row.Id != null ? Number(row.Id) : null,
    employeeId: row.EmployeeId != null ? Number(row.EmployeeId) : null,
    employeeCode: row.EmployeeCode || "",
    employeeName: row.EmployeeName || "",
    employeeType: normalizeEmployeeType(row.EmployeeType) || row.EmployeeType || "",
    employeeStatus: row.EmployeeStatus || row.Status || "",
    employeeIsActive:
      row.EmployeeIsActive == null ? true : Boolean(row.EmployeeIsActive),
    designation: row.DesignationName || "",
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || "",
    district: row.DistrictName || "",
    cityClass: row.CityClass || "",
    payRevision: row.PayRevision || row.RevisionCode || "",
    payLevel: row.PayLevel == null ? null : String(row.PayLevel).trim(),
    payMatrixCell: row.PayMatrixCellNo != null ? Number(row.PayMatrixCellNo) : null,
    basicPay: row.BasicPay != null ? Number(row.BasicPay) : 0,
    medicalAllowanceApplicable: toBool(row.MedicalAllowanceApplicable),
    transportAllowanceApplicable: toBool(row.TransportAllowanceApplicable),
    hraPreviousLocationApplicable: toBool(row.HraPreviousLocationApplicable),
    professionalTaxApplicable: toBool(row.ProfessionalTaxApplicable),
    nppaApplicable: normalizeNppa(row.NppaApplicable),
    effectiveFrom: row.EffectiveFrom,
    effectiveTo: row.EffectiveTo,
    isActive: toBool(row.IsActive),
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
    isDefault: false,
  };
}

function mapEmployeeSnapshot(row) {
  if (!row) return null;
  return {
    employeeId: Number(row.EmployeeId),
    employeeCode: row.EmployeeCode || "",
    employeeName: row.EmployeeName || "",
    designation: row.DesignationName || "",
    employeeType: normalizeEmployeeType(row.EmployeeType) || row.EmployeeType || "",
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || "",
    district:
      row.DistrictName ||
      row.InstituteDistrict ||
      row.InstituteDistrictName ||
      "",
    cityClass:
      row.CityClassName ||
      row.InstituteCityClassName ||
      row.CityClass ||
      "",
    payRevision: row.RevisionCode || "",
    payLevel: row.PayLevel == null ? null : String(row.PayLevel).trim(),
    payMatrixCell:
      row.PayMatrixCellNo != null ? Number(row.PayMatrixCellNo) : null,
    basicPay: row.BasicPay != null ? Number(row.BasicPay) : 0,
    status: row.Status || "Active",
    isActive: row.IsActive == null ? true : Boolean(row.IsActive),
  };
}

async function loadActivePayrollConfig(employeeId, asOfDate) {
  const onDate = asOfDate || new Date().toISOString().slice(0, 10);
  try {
    const request = new sql.Request();
    request.input("EmployeeId", sql.Int, Number(employeeId));
    request.input("AsOfDate", sql.Date, onDate);
    const result = await request.execute(
      "usp_EmployeePayrollConfiguration_GetByEmployee"
    );
    const row = result.recordset?.[0];
    if (!row) return defaultPayrollConfig();
    return mapConfigRow(row);
  } catch (err) {
    /* Fallback query when SP is missing/outdated: latest EffectiveFrom <= as-of. */
    try {
      const result = await sql.query`
        SELECT TOP 1
          c.*,
          e.EmployeeCode,
          e.EmployeeName,
          e.EmployeeType,
          e.Status AS EmployeeStatus,
          ISNULL(e.IsActive, 1) AS EmployeeIsActive
        FROM dbo.EmployeePayrollConfiguration c
        INNER JOIN dbo.EmployeeMaster e ON e.EmployeeId = c.EmployeeId
        WHERE c.EmployeeId = ${Number(employeeId)}
          AND c.EffectiveFrom <= ${onDate}
          AND (c.EffectiveTo IS NULL OR c.EffectiveTo >= ${onDate})
        ORDER BY c.EffectiveFrom DESC, c.Id DESC
      `;
      if (!result.recordset[0]) return defaultPayrollConfig();
      return mapConfigRow(result.recordset[0]);
    } catch (fallbackErr) {
      console.warn("loadActivePayrollConfig fallback:", err.message, fallbackErr.message);
      return defaultPayrollConfig();
    }
  }
}

function canManagePayrollConfig(user) {
  if (!user) return false;
  const role = String(user.roleName || user.RoleName || "").toLowerCase();
  if (!role) return true; /* actor present but role unknown — allow with audit */
  if (role.includes("admin")) return true;
  if (role.includes("account")) return true;
  if (role.includes("auditor")) return true;
  if (role.includes("section")) return false;
  return true;
}

function canConfigureInactiveEmployee(user) {
  const role = String(user?.roleName || user?.RoleName || "").toLowerCase();
  return role.includes("admin");
}

module.exports = {
  defaultPayrollConfig,
  normalizeNppa,
  toBool,
  isHraApplicable,
  isHraForcedZero,
  mapConfigRow,
  mapEmployeeSnapshot,
  loadActivePayrollConfig,
  canManagePayrollConfig,
  canConfigureInactiveEmployee,
};
