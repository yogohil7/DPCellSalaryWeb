/**
 * Institute dropdowns project-wide — natural InstituteCode order.
 *
 * RULE: every normal Institute dropdown sorts by InstituteCode naturally
 * (prefix, then numeric portion, then full code) via the single shared
 * frontend/src/utils/instituteCodeSort.js. InstituteId is NOT a sorting key.
 * GET /api/institutes keeps its original global ordering; each page applies
 * sortInstitutesByCode() as presentation order after its own filters.
 *
 * Covered selectors (14):
 *   SalaryEntry, DADifferenceEntry, EmployeeMaster, EmployeePaySlip,
 *   EmployeeReport, FinalSalaryBill, IncomeTaxProfessionalTax,
 *   IncrementMaster, InstituteWiseSalary, MonthWiseEmployeeSalary,
 *   NpsGpfDeduction, NpsScheduleSummary, SalaryRegister, SalaryVariationReport
 *
 * Usage: cd backend && npm run test:institute-order
 */

const fs = require("fs");
const path = require("path");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const PAGES = path.join(FRONT, "pages");
const read = (file) => fs.readFileSync(path.join(PAGES, file), "utf8");
const utilSrc = fs.readFileSync(
  path.join(FRONT, "utils", "instituteCodeSort.js"),
  "utf8"
);
const institutesSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "institutes.js"),
  "utf8"
);

/* Load the REAL frontend comparator (strip ESM `export ` for this CJS runner). */
const { compareInstituteCodes, sortInstitutesByCode } = new Function(
  `${utilSrc.replace(/^export\s+/gm, "")}; return { compareInstituteCodes, sortInstitutesByCode };`
)();

/* Every page that renders real Institute choices + how it must sort. */
const SELECTOR_PAGES = [
  { file: "SalaryEntry.jsx", uses: ["sortInstitutesByCode"] },
  { file: "DADifferenceEntry.jsx", uses: ["sortInstitutesByCode"] },
  { file: "EmployeeMaster.jsx", uses: ["sortInstitutesByCode"] },
  { file: "EmployeePaySlip.jsx", uses: ["sortInstitutesByCode"] },
  { file: "EmployeeReport.jsx", uses: ["sortInstitutesByCode"] },
  { file: "FinalSalaryBill.jsx", uses: ["sortInstitutesByCode"] },
  { file: "IncomeTaxProfessionalTax.jsx", uses: ["sortInstitutesByCode"] },
  { file: "IncrementMaster.jsx", uses: ["sortInstitutesByCode"] },
  { file: "InstituteWiseSalary.jsx", uses: ["sortInstitutesByCode"] },
  { file: "MonthWiseEmployeeSalary.jsx", uses: ["sortInstitutesByCode"] },
  { file: "NpsGpfDeduction.jsx", uses: ["sortInstitutesByCode"] },
  { file: "NpsScheduleSummary.jsx", uses: ["sortInstitutesByCode"] },
  { file: "SalaryRegister.jsx", uses: ["sortInstitutesByCode"] },
  { file: "SalaryVariationReport.jsx", uses: ["sortInstitutesByCode"] },
];

/* Pages verified to have NO institute picker (display-only / other entity). */
const NO_PICKER_PAGES = [
  "AccountOfficerBills.jsx",
  "BankCopy.jsx",
  "ChequeRegister.jsx",
  "DADifferenceMaster.jsx",
  "EmployeeWiseSalary.jsx",
  "GpfSummary.jsx",
  "InstituteMaster.jsx",
  "InstituteWiseGpfSummary.jsx",
  "NpsInstituteWiseSummary.jsx",
  "NpsSummary.jsx",
  "ReturningBills.jsx",
  "SalaryBillCodeMaster.jsx",
  "SalaryRegisterDetail.jsx",
  "SectionMaster.jsx",
  "SectionSummary.jsx",
  "UserMaster.jsx",
  "TransportAllowanceMaster.jsx",
];

const PLAN_CODES = [
  "PLAN-07", "PLAN-08", "PLAN-09", "PLAN-10", "PLAN-11",
  "PLAN-12", "PLAN-13", "PLAN-14", "PLAN-16", "PLAN-18",
];
const DDRS_CODES = [
  "DDRS-01", "DDRS-02", "DDRS-03", "DDRS-04", "DDRS-06", "DDRS-07",
  "DDRS-08", "DDRS-09", "DDRS-10", "DDRS-11", "DDRS-12", "DDRS-13",
  "DDRS-14", "DDRS-16",
];
/* Scrambled payload across sections (old API order style). */
const SCRAMBLED_ROWS = [
  { instituteId: 54, instituteCode: "PLAN-11", sectionId: 16 },
  { instituteId: 42, instituteCode: "DDRS-09", sectionId: 15 },
  { instituteId: 53, instituteCode: "PLAN-07", sectionId: 16 },
  { instituteId: 31, instituteCode: "DDRS-13", sectionId: 15 },
  { instituteId: 45, instituteCode: "PLAN-10", sectionId: 16 },
  { instituteId: 32, instituteCode: "DDRS-01", sectionId: 15 },
  { instituteId: 40, instituteCode: "DDRS-10", sectionId: 15 },
  { instituteId: 49, instituteCode: "PLAN-12", sectionId: 16 },
  { instituteId: 36, instituteCode: "DDRS-02", sectionId: 15 },
  { instituteId: 50, instituteCode: "PLAN-08", sectionId: 16 },
  { instituteId: 21, instituteCode: "OGE-05", sectionId: 17 },
  { instituteId: 46, instituteCode: "PLAN-09", sectionId: 16 },
];

/* Mirror of the per-page pattern: existing filter first, then natural sort. */
function visibleInstitutes(list, sectionId) {
  const filtered = !sectionId
    ? list
    : list.filter((row) => String(row.sectionId ?? "") === String(sectionId));
  return sortInstitutesByCode(filtered);
}

/* ===================== RUNNER ===================== */
let passed = 0;
let failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
  console.log("-".repeat(t.length));
}

function main() {
  console.log("=".repeat(72));
  console.log("Institute dropdowns project-wide — natural InstituteCode order");
  console.log("=".repeat(72));

  section("A — Salary Entry: PLAN + DDRS natural order");
  check("A. PLAN natural sequence", [...PLAN_CODES].sort(compareInstituteCodes), PLAN_CODES);
  check("A. DDRS natural sequence", [...DDRS_CODES].sort(compareInstituteCodes), DDRS_CODES);

  section("B — Every discovered selector uses the shared utility");
  SELECTOR_PAGES.forEach(({ file, uses }) => {
    const src = read(file);
    uses.forEach((token) =>
      check(`B. ${file} uses ${token}`, src.includes(token), true)
    );
    check(
      `B. ${file} imports instituteCodeSort`,
      /from\s+["']\.\.\/utils\/instituteCodeSort["']/.test(src),
      true
    );
  });

  section("C — Section filtering preserves natural order");
  check(
    "C. PLAN SECTION (16) naturally ordered",
    visibleInstitutes(SCRAMBLED_ROWS, 16).map((r) => r.instituteCode),
    ["PLAN-07", "PLAN-08", "PLAN-09", "PLAN-10", "PLAN-11", "PLAN-12"]
  );
  check(
    "C. DDRS SECTION (15) naturally ordered",
    visibleInstitutes(SCRAMBLED_ROWS, 15).map((r) => r.instituteCode),
    ["DDRS-01", "DDRS-02", "DDRS-09", "DDRS-10", "DDRS-13"]
  );
  check("C. no section shows everything", visibleInstitutes(SCRAMBLED_ROWS, "").length, SCRAMBLED_ROWS.length);

  section("D — Same allowed institutes (filtering untouched)");
  check(
    "D. section filter keeps the same members, only reordered",
    visibleInstitutes(SCRAMBLED_ROWS, 16).map((r) => r.instituteCode).sort(),
    SCRAMBLED_ROWS.filter((r) => r.sectionId === 16).map((r) => r.instituteCode).sort()
  );

  section("E — Special options preserved (not sorted as codes)");
  const specialFiles = {
    "EmployeePaySlip.jsx": "All Institutes",
    "EmployeeReport.jsx": "All Institutes",
    "IncomeTaxProfessionalTax.jsx": "All Institutes",
    "IncrementMaster.jsx": "All Institutes",
    "InstituteWiseSalary.jsx": "All Institutes",
    "MonthWiseEmployeeSalary.jsx": "All Institutes",
    "NpsGpfDeduction.jsx": "All Institutes",
    "NpsScheduleSummary.jsx": "All Institutes",
    "SalaryRegister.jsx": "All Institutes",
    "DADifferenceEntry.jsx": "Select Institute",
    "FinalSalaryBill.jsx": "Select Institute",
    "SalaryVariationReport.jsx": "Select Institute",
  };
  Object.entries(specialFiles).forEach(([file, label]) => {
    const src = read(file);
    check(`E. ${file} keeps "${label}"`, src.includes(`<option value="">${label}</option>`), true);
  });
  check("E. SalaryEntry keeps required Institute Code (no All)", /All Institutes/.test(read("SalaryEntry.jsx")), false);

  section("F/G/H — No duplicates, nothing missing, codes unchanged");
  const sorted = sortInstitutesByCode(SCRAMBLED_ROWS);
  check("F. no duplicate codes", new Set(sorted.map((r) => r.instituteCode)).size, sorted.length);
  check("G. every row survives", sorted.length, SCRAMBLED_ROWS.length);
  check(
    "H. codes unmodified (set-equal)",
    [...sorted.map((r) => r.instituteCode)].sort(),
    [...SCRAMBLED_ROWS.map((r) => r.instituteCode)].sort()
  );

  section("I — InstituteId is not the sorting key");
  SELECTOR_PAGES.forEach(({ file }) => {
    const src = read(file);
    check(
      `I. ${file} has no numeric id sort`,
      /Number\(a\.id\)\s*-\s*Number\(b\.id\)|serialA\s*-\s*serialB/.test(src),
      false
    );
  });
  check("I. API not switched to InstituteId ASC for dropdowns", /ORDER BY\s+i\.InstituteId\s+ASC/i.test(institutesSrc), false);

  section("J — API order does not matter (scrambled input still natural)");
  check(
    "J. scrambled payload renders natural PLAN order",
    sorted.filter((r) => r.instituteCode.startsWith("PLAN-")).map((r) => r.instituteCode),
    ["PLAN-07", "PLAN-08", "PLAN-09", "PLAN-10", "PLAN-11", "PLAN-12"]
  );

  section("K — Numeric cases");
  check("K. DDRS-09 < DDRS-10", compareInstituteCodes("DDRS-09", "DDRS-10") < 0, true);
  check("K. PLAN-09 < PLAN-10", compareInstituteCodes("PLAN-09", "PLAN-10") < 0, true);
  check("K. ABC-2 < ABC-10 (unpadded)", compareInstituteCodes("ABC-2", "ABC-10") < 0, true);
  check("K. PLAN-11 < PLAN-12", compareInstituteCodes("PLAN-11", "PLAN-12") < 0, true);

  section("L — Single shared comparator (no duplicates)");
  const dupes = SELECTOR_PAGES.filter(({ file }) => {
    const src = read(file);
    return /function\s+compareInstituteCodes|const\s+compareInstituteCodes\s*=/.test(src);
  }).map(({ file }) => file);
  check("L. no page defines its own comparator", dupes, []);
  check("L. util has no hard-coded prefixes", /DDRS|PLAN/.test(utilSrc), false);

  section("M — No-picker pages left untouched");
  NO_PICKER_PAGES.forEach((file) => {
    let src = "";
    try {
      src = read(file);
    } catch {
      return;
    }
    check(`M. ${file} does not import instituteCodeSort`, src.includes("instituteCodeSort"), false);
  });

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main();
