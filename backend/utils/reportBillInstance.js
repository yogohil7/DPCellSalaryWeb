/**
 * REPORTS: resolving the Bill Month INSTANCE a report row belongs to
 * (2026-09-24, multiple-Bill-Months-per-Salary-Month rule, migrations 49-51).
 *
 * One SalaryBillCodes row (e.g. BillCodeId 1018, AUG-2026) can now carry
 * several independent Bill Month instances per institute:
 *
 *   SalaryBillInstituteWorkflow  (SalaryBillCodeId, InstituteCode, BillMonth)
 *     1018 / DDRS-16 / AUG-2026  WorkflowId 52   <- canonical instance
 *     1018 / DDRS-16 / JUL-2026  WorkflowId 62   <- earlier Bill Month
 *
 * A report row is therefore identified by the WORKFLOW ROW (WorkflowId),
 * never by (SalaryBillCodeId, InstituteCode), and never takes its Bill
 * Month from SalaryBillCodes.BillMonth (the master's, shared by all
 * instances). Everything here is READ-ONLY: nothing is created or updated.
 *
 *   instanceEmployeeRowsSql() - derived table of each instance's OWN
 *       employee rows, keyed by InstanceWorkflowId:
 *         canonical instance / "-BM-" variant bill -> dbo.SalaryEmployeeDetails
 *         earlier Bill Month instance -> dbo.SalaryEntryBillEmployeeDetails
 *       Replaces `JOIN dbo.SalaryEmployeeDetails d ON bill AND institute`,
 *       which gave an earlier-Bill-Month instance the canonical instance's
 *       employees (the same people/amounts counted twice).
 *   instanceBillMonthPartsOf(row) - the instance's Bill Month.
 *   loadInstanceHeaders() / resolveInstanceHeader() - Bill No. / Bill Date /
 *       NPS Schedule No. of exactly that instance.
 */
const { sql } = require("../db");
const { normalizeYearMonth, formatMonthLabel } = require("./salaryMonthKey");

/* The label migration 51 wrote for a bill's canonical (Bill Month == Salary
   Month) instance. Same expression as migrations 51/52 and the approval
   queue, so SQL and data agree. */
function canonicalBillMonthSql(alias) {
  return `UPPER(LEFT(LTRIM(RTRIM(${alias}.SalaryMonth)), 3)) + N'-' + CAST(${alias}.SalaryYear AS NVARCHAR(4))`;
}

/* Columns shared by dbo.SalaryEmployeeDetails and
   dbo.SalaryEntryBillEmployeeDetails (migration 50 mirrors the former). */
const INSTANCE_EMPLOYEE_COLUMNS = [
  "Id", "SalaryBillCodeId", "InstituteCode", "EmployeeId", "EmployeeName",
  "Designation", "EmployeeType", "PensionType", "DisplayOrder",
  "BasicPay", "GradePay", "TotalBasic", "DA", "HRA", "MA", "TA", "CLA",
  "SpecialAllowance", "WashingAllowance", "OtherEarnings", "NPPA", "GrossSalary",
  "GPFSubscription", "GPFAdvance", "NPS", "NPSAdvance", "IncomeTax",
  "ProfessionalTax", "OtherDeduction", "TotalDeduction", "NetSalary", "ChequeAmount",
  "PayRevisionId", "PayLevel", "PayMatrixCellNo", "PayMatrixId",
  "DAPercentage", "HRAPercentage", "DARate", "HRARate", "NPSManual",
];

/**
 * `(SELECT ...) ` derived table: one row per employee of each workflow
 * instance, with InstanceWorkflowId = SalaryBillInstituteWorkflow.WorkflowId
 * and InstanceBillMonth = that row's BillMonth. Constant SQL - no user value
 * is ever concatenated in.
 */
function instanceEmployeeRowsSql() {
  const cols = (a) => INSTANCE_EMPLOYEE_COLUMNS.map((c) => `${a}.${c}`).join(", ");
  return `(
      SELECT iw0.WorkflowId AS InstanceWorkflowId, iw0.BillMonth AS InstanceBillMonth, ${cols("ed0")}
      FROM dbo.SalaryBillInstituteWorkflow iw0
      INNER JOIN dbo.SalaryBillCodes ib0 ON ib0.BillCodeId = iw0.SalaryBillCodeId
      INNER JOIN dbo.SalaryEmployeeDetails ed0
        ON ed0.SalaryBillCodeId = iw0.SalaryBillCodeId
       AND ed0.InstituteCode = iw0.InstituteCode
      WHERE iw0.BillMonth = ${canonicalBillMonthSql("ib0")}
         OR ib0.BillCode LIKE N'%-BM-%'
      UNION ALL
      SELECT iw1.WorkflowId, iw1.BillMonth, ${cols("ed1")}
      FROM dbo.SalaryBillInstituteWorkflow iw1
      INNER JOIN dbo.SalaryBillCodes ib1 ON ib1.BillCodeId = iw1.SalaryBillCodeId
      INNER JOIN dbo.SalaryEntryBillEmployeeDetails ed1
        ON ed1.SalaryBillCodeId = iw1.SalaryBillCodeId
       AND ed1.InstituteCode = iw1.InstituteCode
       AND ed1.BillMonth = iw1.BillMonth
      WHERE iw1.BillMonth <> ${canonicalBillMonthSql("ib1")}
        AND ib1.BillCode NOT LIKE N'%-BM-%'
    )`;
}

/**
 * SELECT-list fragment for report loaders whose downstream code reads
 * row.BillMonth: exposes the INSTANCE Bill Month under that name (the
 * workflow row's own BillMonth; a pre-existing "-BM-" variant bill keeps its
 * own SalaryBillCodes.BillMonth), the master value as MasterBillMonth, and
 * the instance id. `b` = SalaryBillCodes alias, `w` = workflow alias.
 */
function instanceBillMonthSelectSql(b = "b", w = "w") {
  return `${b}.BillMonth AS MasterBillMonth,
      CASE WHEN ${b}.BillCode LIKE N'%-BM-%' THEN ${b}.BillMonth ELSE ${w}.BillMonth END AS BillMonth,
      ${w}.WorkflowId AS ReportWorkflowId,
      ${w}.BillMonth AS WorkflowBillMonth`;
}

/**
 * Overwrite BillNo / BillDate / NPSScheduleNo on raw loader rows with the
 * values of each row's OWN instance (see resolveInstanceHeader). Rows need
 * BillCodeId, InstituteCode, BillCode, BillMonth (instance), SalaryYear.
 */
async function applyInstanceHeaders(rows) {
  const headers = await loadInstanceHeaders();
  for (const row of rows) {
    const h = resolveInstanceHeader(headers, row, instanceBillMonthLabel(row));
    row.BillNo = h.billNo || null;
    row.BillDate = h.billDate || null;
    row.NPSScheduleNo = h.npsScheduleNo || null;
    row.HeaderSource = h.headerSource;
  }
  return rows;
}

/** Run a constant report query (no parameters) - needed because a derived
    table cannot be spliced into a parameterised tagged template. */
function queryReport(text) {
  return new sql.Request().query(text);
}

/**
 * The Bill Month of the instance a row reports.
 *   - normal bill: the workflow row's own BillMonth (row.WorkflowBillMonth);
 *   - pre-existing "-BM-" variant bill (e.g. AUG-2026-BM-JUL): that bill IS
 *     the earlier-month bill, so its own SalaryBillCodes.BillMonth; migration
 *     51 labelled its workflow row with the Salary Month;
 *   - neither (pre-migration data): the master BillMonth, then Salary Month.
 */
function instanceBillMonthPartsOf(row) {
  const isVariantBill = /-BM-[A-Z]{3}$/i.test(String(row.BillCode || "").trim());
  const source = isVariantBill ? row.BillMonth : row.WorkflowBillMonth;
  return (
    normalizeYearMonth(source, row.SalaryYear, null) ||
    normalizeYearMonth(row.BillMonth, row.SalaryYear, null) ||
    normalizeYearMonth(row.SalaryMonth, row.SalaryYear, row.SalaryMonthNumber)
  );
}

function instanceBillMonthLabel(row) {
  return formatMonthLabel(instanceBillMonthPartsOf(row)) || "";
}

/**
 * Every per-Bill-Month header (dbo.SalaryEntryBillHeader, migration 49) as a
 * Map keyed `${billCodeId}|${instituteCode}|${BILLMONTH}`. Read-only; an
 * un-migrated database simply yields an empty map.
 */
async function loadInstanceHeaders() {
  const map = new Map();
  try {
    const result = await sql.query`
      SELECT SalaryBillCodeId, InstituteCode, BillMonth, BillNo, BillDate, NPSScheduleNo
      FROM dbo.SalaryEntryBillHeader
    `;
    for (const h of result.recordset) {
      map.set(headerKey(h.SalaryBillCodeId, h.InstituteCode, h.BillMonth), h);
    }
  } catch (err) {
    if (!/invalid object name/i.test(String(err.message))) throw err;
  }
  return map;
}

function headerKey(billCodeId, instituteCode, billMonth) {
  return `${Number(billCodeId)}|${String(instituteCode || "").trim().toUpperCase()}|${String(billMonth || "").trim().toUpperCase()}`;
}

/**
 * Bill No. / Bill Date / NPS Schedule No. of exactly this instance:
 *   1. its dbo.SalaryEntryBillHeader row (billCodeId, institute, Bill Month);
 *   2. otherwise the legacy BillNo/BillDate/NPSScheduleNo columns ON ITS OWN
 *      workflow row (row.BillNo etc., selected from that same w row) - values
 *      saved before migration 49 by that very instance.
 * Never another instance's values: a JUL row with neither is blank.
 */
function resolveInstanceHeader(headers, row, billMonthLabel) {
  const h = headers.get(headerKey(row.BillCodeId, row.InstituteCode, billMonthLabel));
  const pick = (a, b) => (a != null && String(a).trim() !== "" ? a : b);
  const billNo = pick(h?.BillNo, row.BillNo);
  const billDate = pick(h?.BillDate, row.BillDate);
  const npsScheduleNo = pick(h?.NPSScheduleNo, row.NPSScheduleNo);
  return {
    billNo: billNo != null ? String(billNo).trim() : "",
    billDate: billDate || null,
    npsScheduleNo: npsScheduleNo != null ? String(npsScheduleNo).trim() : "",
    headerSource: h ? "SalaryEntryBillHeader" : (row.BillNo != null && String(row.BillNo).trim() !== "" ? "workflow-row" : "none"),
  };
}

module.exports = {
  canonicalBillMonthSql,
  INSTANCE_EMPLOYEE_COLUMNS,
  instanceEmployeeRowsSql,
  instanceBillMonthSelectSql,
  applyInstanceHeaders,
  queryReport,
  instanceBillMonthPartsOf,
  instanceBillMonthLabel,
  loadInstanceHeaders,
  resolveInstanceHeader,
  headerKey,
};
