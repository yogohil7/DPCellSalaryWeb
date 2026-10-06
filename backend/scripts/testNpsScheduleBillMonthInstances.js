/**
 * NPS Schedule — two Bill Month instances of one bill stay two rows.
 *
 * ROOT CAUSE (live): WorkflowId 52 = bill 1018 / DDRS-16 / AUG-2026 and
 * WorkflowId 62 = bill 1018 / DDRS-16 / JUL-2026 share one SalaryBillCodeId.
 * buildScheduleGroups() keyed by institute+bill only, so the JUL-2026 OLD
 * instance folded into the AUG-2026 REGULAR line (one row, merged amount,
 * JUL month/type/schedule number lost). Fix: the group key includes the
 * instance Bill Month (paidMonth).
 *
 * Live note: DDRS-16/JUL-2026 currently has ZERO saved NPS, so the live
 * report correctly shows only AUG-2026 (non-zero rule, same as NPS
 * Summary). This test proves the display bug with synthetic non-zero rows;
 * no salary/workflow data is fabricated or modified.
 *
 * Runs offline. Usage: cd backend && npm run test:nps-schedule-instances
 */

const fs = require("fs");
const path = require("path");
const {
  buildScheduleGroups,
  parseBillType,
} = require("../routes/npsSchedule");
const {
  filterSalaryRows,
} = require("../routes/employeeWiseSalary");
const {
  billTypeMatchesFilter,
} = require("../utils/salaryMonthKey");

const routeSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "npsSchedule.js"),
  "utf8"
);

function row(paidMonth, type, schedNo, nps, employeeId = 1) {
  return {
    instituteCode: "DDRS-16",
    instituteName: "Institute",
    sectionId: 15,
    sectionName: "Section",
    sectionSrNo: 5,
    npsScheduleNo: schedNo,
    salaryMonth: "AUG-2026",
    salaryMonthIndex: 2026 * 12 + 8,
    paidMonth,
    billMonthIndex: paidMonth === "JUL-2026" ? 2026 * 12 + 7 : 2026 * 12 + 8,
    type,
    billCodeId: 1018,
    billCode: "AUG-2026",
    employeeId,
    employeeCode: `E${employeeId}`,
    employeeName: "Name",
    pran: "",
    nps,
  };
}

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
  console.log("NPS Schedule — Bill Month instances stay separate rows");
  console.log("=".repeat(72));

  section("A — Two instances of one bill are two rows");
  const groups = buildScheduleGroups([
    row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 6000),
    row("JUL-2026", "OLD", "SCH/7/2026/153117", 5000),
  ]);
  check("A. two groups, not one merged row", groups.length, 2);
  const aug = groups.find((g) => g.billMonth === "AUG-2026");
  const jul = groups.find((g) => g.billMonth === "JUL-2026");
  check("A. AUG keeps REGULAR type", aug && aug.billType, "REGULAR");
  check("A. JUL keeps OLD type", jul && jul.billType, "OLD");
  check("A. AUG keeps its schedule no.", aug && aug.scheduleNo, "SCH/8/2026/176616");
  check("A. JUL keeps its schedule no.", jul && jul.scheduleNo, "SCH/7/2026/153117");
  check("A. AUG keeps its headcount", aug && aug.employeeCount, 1);
  check("A. JUL keeps its headcount", jul && jul.employeeCount, 1);
  check("A. AUG keeps its saved NPS amount", aug && aug.amount, 6000);
  check("A. JUL keeps its saved NPS amount", jul && jul.amount, 5000);

  section("B — Same-instance rows still merge");
  const same = buildScheduleGroups([
    row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 6000, 1),
    row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 4000, 2),
  ]);
  check("B. one group for one instance", same.length, 1);
  check("B. headcount sums", same[0] && same[0].employeeCount, 2);
  check("B. stored NPS sums", same[0] && same[0].amount, 10000);

  section("C — MR-29 live shape: zero JUL excluded, non-zero JUL kept");
  /* Live: WF81 AUG-2026 (canonical 8 rows, NPS 56859), WF80 JUL-2026
     (instance 8 rows). The report keeps only non-zero NPS rows. */
  const mrZeroJul = [
    { ...row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 7000), instituteCode: "MR-29", billCodeId: 1018, employeeCount: undefined },
    { ...row("JUL-2026", "OLD", "SCH/7/2026/153117", 0), instituteCode: "MR-29", billCodeId: 1018 },
  ];
  const keptZero = mrZeroJul.filter((r) => Number(r.nps) !== 0);
  check("C. zero-NPS JUL row excluded by the non-zero rule", keptZero.length, 1);
  check(
    "C. zero-JUL case leaves one AUG group",
    buildScheduleGroups(keptZero).map((g) => g.billMonth),
    ["AUG-2026"]
  );
  const mrBoth = buildScheduleGroups([
    { ...row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 7107), instituteCode: "MR-29", billCodeId: 1018, employeeId: 1 },
    { ...row("AUG-2026", "REGULAR", "SCH/8/2026/176616", 7107), instituteCode: "MR-29", billCodeId: 1018, employeeId: 2 },
    { ...row("JUL-2026", "OLD", "SCH/7/2026/153117", 7426), instituteCode: "MR-29", billCodeId: 1018, employeeId: 1 },
    { ...row("JUL-2026", "OLD", "SCH/7/2026/153117", 7426), instituteCode: "MR-29", billCodeId: 1018, employeeId: 2 },
  ]);
  check("C. non-zero JUL yields two MR-29 groups", mrBoth.length, 2);
  const mrJul = mrBoth.find((g) => g.billMonth === "JUL-2026");
  const mrAug = mrBoth.find((g) => g.billMonth === "AUG-2026");
  check("C. JUL type OLD / AUG type REGULAR", [mrJul && mrJul.billType, mrAug && mrAug.billType], ["OLD", "REGULAR"]);
  check("C. per-instance schedule numbers kept", [mrJul && mrJul.scheduleNo, mrAug && mrAug.scheduleNo], ["SCH/7/2026/153117", "SCH/8/2026/176616"]);
  check("C. per-instance headcounts kept", [mrJul && mrJul.employeeCount, mrAug && mrAug.employeeCount], [2, 2]);
  check("C. per-instance saved NPS kept", [mrJul && mrJul.amount, mrAug && mrAug.amount], [14852, 14214]);

  section("D — 'Regular Salary (incl. Old)' returns REGULAR + OLD");
  const pageSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "pages", "NpsScheduleSummary.jsx"),
    "utf8"
  );
  check(
    "D. dropdown sends value REGULAR for the combined label",
    /<option value="REGULAR">Regular Salary \(incl\. Old\)<\/option>/.test(pageSrc),
    true
  );
  check("D. parseBillType keeps REGULAR combined", parseBillType("REGULAR"), "REGULAR");
  check("D. parseBillType keeps OLD narrow", parseBillType("OLD"), "OLD");
  const comboRows = [
    { workflowStatus: "LOCKED", sectionId: 15, employeeId: 1, type: "REGULAR", salaryMonthIndex: 2026 * 12 + 8, nps: 100 },
    { workflowStatus: "LOCKED", sectionId: 15, employeeId: 2, type: "OLD", salaryMonthIndex: 2026 * 12 + 8, nps: 200 },
  ];
  check(
    "D. combined scope keeps both types",
    filterSalaryRows(comboRows, { month: "8", year: "2026", salaryType: "ALL" }).map((r) => r.type),
    ["REGULAR", "OLD"]
  );
  check(
    "D. OLD-only scope stays narrow",
    filterSalaryRows(comboRows, { month: "8", year: "2026", salaryType: "OLD" }).map((r) => r.type),
    ["OLD"]
  );
  check("D. REGULAR matches OLD rows", billTypeMatchesFilter("REGULAR", "OLD"), true);
  check("D. OLD does not match REGULAR rows", billTypeMatchesFilter("OLD", "REGULAR"), false);
  check(
    "D. zero-NPS OLD row still excluded by the non-zero rule",
    comboRows.filter((r) => Number(r.nps) !== 0).length === 2 &&
      [{ ...comboRows[1], nps: 0 }].filter((r) => Number(r.nps) !== 0).length === 0,
    true
  );

  section("E — Source guards");
  check(
    "C. group key includes the instance Bill Month",
    /row\.instituteCode\}\|\$\{row\.billCodeId\}\|\$\{row\.paidMonth/.test(routeSrc),
    true
  );
  check(
    "C. non-zero NPS rule intact (matches NPS Summary)",
    /toNum\(row\.nps\) !== 0/.test(routeSrc),
    true
  );
  check(
    "C. no fabricated schedule numbers in route",
    /SCH\/\d/.test(routeSrc),
    false
  );

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
