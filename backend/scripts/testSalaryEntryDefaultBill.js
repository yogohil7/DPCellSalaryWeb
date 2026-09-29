/**
 * Salary Entry default bill selection + returned-bill routing (A-M).
 *
 * Replays the real ordering used by GET /api/salary-entry/bill-codes and the
 * real preference chain in SalaryEntry.loadBillCodes, so the default can no
 * longer drift onto a Bill-Month variant.
 *
 * Runs offline. Usage: cd backend && npm run test:default-bill
 */

const fs = require("fs");
const path = require("path");

/* ===================== FIXTURE =====================
   Note the column formats: BillMonth is 'JUN-2026' while SalaryMonth is
   'June'. They are NOT comparable as strings — the canonical bill is the
   one whose BillCode carries no -BM-XXX suffix.
   The MAY variant has the HIGHER BillCodeId (created later), which is what
   used to make it win the default.                                        */

const BILLS = [
  { BillCodeId: 100, BillCode: "JUN-2026", BillMonth: "JUN-2026",
    SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026", Status: "OPEN" },
  { BillCodeId: 101, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
    SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026", Status: "OPEN" },
  { BillCodeId: 102, BillCode: "JUN-2026-BM-APR", BillMonth: "APR-2026",
    SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026", Status: "OPEN" },
  { BillCodeId: 90, BillCode: "MAY-2026", BillMonth: "MAY-2026",
    SalaryMonth: "May", SalaryMonthNumber: "05", SalaryYear: "2026", Status: "OPEN" },
];

/** Mirrors the shipped ORDER BY in GET /api/salary-entry/bill-codes. */
function orderBillCodes(rows) {
  return [...rows].sort((a, b) =>
    String(b.SalaryYear).localeCompare(String(a.SalaryYear)) ||
    Number(b.SalaryMonthNumber) - Number(a.SalaryMonthNumber) ||
    (/-BM-/i.test(a.BillCode) ? 1 : 0) - (/-BM-/i.test(b.BillCode) ? 1 : 0) ||
    Number(b.BillCodeId) - Number(a.BillCodeId)
  );
}

/** The OLD ordering, kept to prove the regression. */
function legacyOrder(rows) {
  return [...rows].sort((a, b) =>
    String(b.SalaryYear).localeCompare(String(a.SalaryYear)) ||
    Number(b.SalaryMonthNumber) - Number(a.SalaryMonthNumber) ||
    Number(b.BillCodeId) - Number(a.BillCodeId)
  );
}

const toApi = (r) => ({
  billCodeId: r.BillCodeId, billCode: r.BillCode, billMonth: r.BillMonth,
  salaryMonth: r.SalaryMonth, salaryMonthNumber: r.SalaryMonthNumber,
  salaryYear: r.SalaryYear, status: r.Status,
});

/** Mirrors the preference chain in SalaryEntry.loadBillCodes. */
function pickPreferred(list, { initialBillCode = "", preferredCode = "" } = {}) {
  const up = (v) => String(v || "").trim().toUpperCase();
  return (
    (initialBillCode && list.find((r) => up(r.billCode) === up(initialBillCode))) ||
    (preferredCode && list.find((r) => r.billCode === preferredCode)) ||
    list.find((r) => up(r.billCode) === up(preferredCode).replace(/-BM-[A-Z]{3}$/i, "")) ||
    list[0]
  );
}

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

function main() {
  console.log("=".repeat(72));
  console.log("Salary Entry default bill + returned-bill routing (A-M)");
  console.log("=".repeat(72));

  const list = orderBillCodes(BILLS).map(toApi);

  /* ---------------- A / B ---------------- */
  section("A, B — normal open lands on the latest salary month, canonical bill");

  const def = pickPreferred(list);
  check("A. defaults to the latest salary month", def.salaryMonthNumber, "06");
  check("A. and the latest year", def.salaryYear, "2026");
  check("A. canonical bill code JUN-2026", def.billCode, "JUN-2026");
  check("A. Bill Month is JUN-2026", def.billMonth, "JUN-2026");
  check("B. NOT the MAY Bill-Month variant", def.billCode !== "JUN-2026-BM-MAY", true);
  check("B. Bill Month is not MAY-2026", def.billMonth !== "MAY-2026", true);
  check("B. not the APR variant either", def.billCode !== "JUN-2026-BM-APR", true);

  /* The regression this guards against. */
  check("legacy ordering picked a Bill-Month VARIANT, not the canonical bill",
    /-BM-/.test(legacyOrder(BILLS)[0].BillCode), true);
  check("legacy ordering picked whichever variant was created last",
    legacyOrder(BILLS)[0].BillCodeId, 102);
  check("legacy ordering did NOT pick JUN-2026",
    legacyOrder(BILLS)[0].BillCode !== "JUN-2026", true);
  check("fixed ordering picks the canonical bill",
    orderBillCodes(BILLS)[0].BillCode, "JUN-2026");
  check("nothing is hard-coded to JUN — a later month wins",
    orderBillCodes([
      ...BILLS,
      { BillCodeId: 110, BillCode: "JUL-2026", BillMonth: "JUL-2026",
        SalaryMonth: "July", SalaryMonthNumber: "07", SalaryYear: "2026", Status: "OPEN" },
    ])[0].BillCode, "JUL-2026");
  check("a later YEAR wins over a later month",
    orderBillCodes([
      ...BILLS,
      { BillCodeId: 5, BillCode: "JAN-2027", BillMonth: "JAN-2027",
        SalaryMonth: "January", SalaryMonthNumber: "01", SalaryYear: "2027", Status: "OPEN" },
    ])[0].BillCode, "JAN-2027");

  /* ---------------- E / F ---------------- */
  section("E, F — Edit/Correct opens the EXACT returned bill");

  const opened = pickPreferred(list, { initialBillCode: "JUN-2026-BM-MAY" });
  check("E/F. opens JUN-2026-BM-MAY", opened.billCode, "JUN-2026-BM-MAY");
  check("F. does NOT open the JUN-2026 master", opened.billCode !== "JUN-2026", true);
  check("E. exact BillCodeId carried through", opened.billCodeId, 101);
  check("E. case-insensitive match still exact",
    pickPreferred(list, { initialBillCode: "jun-2026-bm-may" }).billCodeId, 101);

  /* ---------------- C / D / G / H / I ---------------- */
  section("C, D, G, H, I — Bill Month stays MAY-2026 throughout");

  check("C. list/entry Bill Month is MAY-2026", opened.billMonth, "MAY-2026");
  check("D. Salary Month is June", opened.salaryMonth, "June");
  check("C. Bill Month is not derived from Salary Month",
    opened.billMonth !== "JUN-2026", true);

  /* Get Data / Save Draft / Submit all re-resolve with preferredCode. */
  for (const step of ["Get Data", "Save Draft", "Submit"]) {
    const again = pickPreferred(list, { preferredCode: "JUN-2026-BM-MAY" });
    check(`${step}: still JUN-2026-BM-MAY`, again.billCode, "JUN-2026-BM-MAY");
    check(`${step}: Bill Month still MAY-2026`, again.billMonth, "MAY-2026");
  }

  /* ---------------- K / L ---------------- */
  section("K, L — other bills stay independent");

  check("K. the JUN-2026 master is a different row",
    list.find((r) => r.billCode === "JUN-2026").billCodeId, 100);
  check("K. master keeps its own Bill Month",
    list.find((r) => r.billCode === "JUN-2026").billMonth, "JUN-2026");
  check("L. the APR variant keeps its own Bill Month",
    list.find((r) => r.billCode === "JUN-2026-BM-APR").billMonth, "APR-2026");
  check("L. opening APR does not select MAY",
    pickPreferred(list, { initialBillCode: "JUN-2026-BM-APR" }).billMonth, "APR-2026");
  check("K/L. all three JUN bills have distinct ids",
    new Set(list.filter((r) => r.salaryMonthNumber === "06").map((r) => r.billCodeId)).size, 3);

  /* ---------------- M ---------------- */
  section("M — an auditor cannot reach another auditor's returned bill");

  const approvalSrc = read("routes/salaryBillApproval.js");
  check("M. auditor scope comes from the token",
    /isAuditor\s*\?\s*Number\(req\.user\?\.userId\)/.test(approvalSrc), true);
  check("M. the query param is not trusted for auditors",
    /const auditorUserId = isAuditor[\s\S]{0,120}Number\(req\.query\.auditorUserId\)/.test(approvalSrc),
    true);
  check("M. listing filters on ReturnedToAuditorId",
    /AND w\.ReturnedToAuditorId = \$\{Number\(auditorUserId\)\}/.test(approvalSrc), true);
  check("M. approval actions remain Account Officer only",
    /router\.post\("\/:idOrCode\/approve", accountOfficerOnly/.test(approvalSrc), true);

  /* ---------------- J + wiring ---------------- */
  section("J + wiring — shipped code matches these rules");

  const entrySrc = read("routes/salaryEntry.js");
  const daSrc = read("utils/daDifference.js");

  check("ordering prefers canonical over Bill-Month variants",
    /CASE WHEN BillCode LIKE N'%-BM-%' THEN 1 ELSE 0 END/.test(entrySrc), true);
  check("ordering is still newest salary month first",
    /SalaryYear DESC,\s*SalaryMonthNumber DESC/.test(entrySrc), true);
  /* Strip comments first: the explanation above the clause names JUN-2026
     as an example, which is documentation, not a hard-coded value. */
  const orderByClause = entrySrc
    .slice(entrySrc.indexOf('router.get("/bill-codes"'),
           entrySrc.indexOf('router.get("/employees"'))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  check("no hard-coded month anywhere in the bill-codes handler",
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{4}/i.test(orderByClause), false);
  check("no hard-coded year either",
    /\b20\d{2}\b/.test(orderByClause), false);

  const headerSrc = read("utils/salaryEntryBillHeader.js");
  check("J. NPS Schedule No. read from the resolved bill's own header (bill-month-specific)",
    /getSalaryEntryBillHeader\(/.test(entrySrc), true);
  check("J. and written scoped to that exact bill + institute + Bill Month",
    /NPSScheduleNo = \$\{npsScheduleNo \|\| null\}/.test(headerSrc) &&
      /SalaryBillCodeId = \$\{Number\(billCodeId\)\}[\s\S]{0,120}AND InstituteCode[\s\S]{0,120}AND BillMonth/.test(headerSrc),
    true);

  check("Bill Month still gated on the exact resolved bill",
    /assertBillEditable\(statusGateBill\(resolved\)\)/.test(entrySrc), true);
  check("returned-bill listing takes BillMonth from the workflow row itself (migration 51), never the bill master's BillMonth column",
    /const instanceBillMonth = row\.WorkflowBillMonth \|\| "";/.test(approvalSrc), true);

  /* DA no longer needs a canonical-vs-variant preference at all: it matches
     each month on the bill's real BillMonth in JS (pickSnapshotForBillMonth),
     so JUN-2026 and JUN-2026-BM-MAY can never contend for the same month. */
  check("DA snapshot selects on the bill's real BillMonth",
    /billMonthPartsFromSalaryBill\(row\)/.test(daSrc), true);
  check("DA snapshot tie-break is deterministic, not BillCodeId DESC",
    /ORDER BY b\.BillCodeId DESC/.test(daSrc), false);
  check("DA snapshot no longer compares BillMonth with SalaryMonth",
    /ISNULL\(b\.BillMonth, N''\)\)\) =\s*UPPER\(LTRIM\(RTRIM\(ISNULL\(b\.SalaryMonth/.test(daSrc),
    false);

  /* No second mechanism was introduced. */
  const uiSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8"
  );
  check("frontend still uses the single existing preference chain",
    /const preferred =/.test(uiSrc), true);
  check("frontend adds no competing canonical sort",
    /BM-[\s\S]{0,40}sort\(/.test(uiSrc), false);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
