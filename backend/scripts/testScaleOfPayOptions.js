/**
 * Employee Master Scale of Pay dropdown — 12 exact options in exact order.
 *
 * Storage is free text (dbo scale column via NVarChar(100), backend only
 * trims — no whitelist), option text IS the saved value, so save/load is a
 * plain string round-trip. All 4 legacy options are contained in the new 12,
 * so existing employee records remain compatible and selectable.
 *
 * Runs offline. Usage: cd backend && npm run test:scale-of-pay
 */

const fs = require("fs");
const path = require("path");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(
  path.join(FRONT, "pages", "EmployeeMaster.jsx"),
  "utf8"
);
const employeesSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "employees.js"),
  "utf8"
);

const EXPECTED = [
  "14800-47100 (IS-1)",
  "15000-47600 (IS-2)",
  "15700-50000 (IS-3)",
  "18000-56900 (Level-1)",
  "19900-63200 (Level-2)",
  "21700-69100 (Level-3)",
  "25500-81100 (Level-4)",
  "29200-92300 (Level-5)",
  "35400-112400 (Level-6)",
  "39900-126600 (Level-7)",
  "44900-142400 (Level-8)",
  "53100-167800 (Level-9)",
];
const LEGACY = [
  "14800-47100 (IS-1)",
  "18000-56900 (Level-1)",
  "19900-63200 (Level-2)",
  "35400-112400 (Level-6)",
];

/* Extract the Scale of Pay <select> block (label -> closing select). */
function scaleSelectBlock() {
  const labelIdx = pageSrc.indexOf('label="Scale of Pay"');
  if (labelIdx < 0) return "";
  const selectStart = pageSrc.indexOf("<select", labelIdx);
  const selectEnd = pageSrc.indexOf("</select>", selectStart);
  if (selectStart < 0 || selectEnd < 0) return "";
  return pageSrc.slice(selectStart, selectEnd + "</select>".length);
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
  console.log("Employee Master Scale of Pay — 12 options, exact order");
  console.log("=".repeat(72));

  const block = scaleSelectBlock();
  const options = [...block.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);

  section("A — Exact options in exact order (placeholder first)");
  check("A. placeholder text is first", options[0], "Select");
  check("A. placeholder label", /<option value="">Select<\/option>/.test(block), true);
  check("A. all 12 scales in order", options.slice(1), EXPECTED);
  check("A. exactly 13 options total (1 placeholder + 12)", options.length, 13);

  section("B — Old list replaced, not appended");
  check(
    "B. no extra scale options beyond the 12",
    options.slice(1).filter((o) => !EXPECTED.includes(o)),
    []
  );

  section("C — Stored format compatible (free text round-trip)");
  check("C. options carry no value attr (text IS the value)", /<option value=/.test(block.replace('<option value="">Select</option>', "")), false);
  check("C. backend only trims scaleOfPay (no whitelist)", /scaleOfPay[^;]*\.trim\(\)/.test(employeesSrc), true);
  check("C. backend has no scale whitelist check", /ScaleOfPay.*IN\s*\(|validScales|ALLOWED_SCALES/i.test(employeesSrc), false);
  const longest = Math.max(...EXPECTED.map((s) => s.length));
  check("C. longest value fits NVarChar(100)", longest <= 100, true);
  check("C. save sends form value or null", /scaleOfPay:\s*form\.scaleOfPay \|\| null/.test(pageSrc), true);
  check("C. edit loads stored value into form", /scaleOfPay:\s*e\.scaleOfPay \|\| ""/.test(pageSrc), true);

  section("D — Existing records remain compatible");
  check("D. all 4 legacy values still offered", LEGACY.every((v) => EXPECTED.includes(v)), true);

  section("E — Rest of Employee Master untouched");
  check("E. pay-level select intact", /levels\.map\(\(level\)/.test(pageSrc), true);
  check("E. pay-matrix cell select intact", /cells\.map\(\(cell\)/.test(pageSrc), true);
  check("E. pay-level change handler intact", /handlePayLevelChange/.test(pageSrc), true);
  check("E. pay-cell change handler intact", /handlePayCellChange/.test(pageSrc), true);
  check("E. Basic Pay readonly from matrix", /From Pay Matrix after Level \+ Cell/.test(pageSrc), true);
  check("E. save/edit paths intact", /createEmployee\(payload/.test(pageSrc) && /updateEmployee\(form\.id, payload/.test(pageSrc), true);

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
