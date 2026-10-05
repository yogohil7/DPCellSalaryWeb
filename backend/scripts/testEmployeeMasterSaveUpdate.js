/**
 * Employee Master Save/Update button behavior.
 *
 *   New form (EMPTY.id === "")            -> primary button "Save"
 *   Edit loads row (id = row.id||employeeId) -> button "Update"
 *   Submit branches on existing isEditMode  -> updateEmployee(form.id)
 *     vs createEmployee(payload); employee ID preserved (read-only field).
 *   Reset in edit mode -> prepareNewForm() (id cleared) -> back to "Save".
 *   Cancel -> existing onBack (leaves the page).
 *
 * Runs offline. Usage: cd backend && npm run test:employee-save-update
 */

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "EmployeeMaster.jsx"),
  "utf8"
);

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
  console.log("Employee Master Save/Update button");
  console.log("=".repeat(72));

  section("A — New employee form displays Save");
  check("A. EMPTY form has falsy id", /const EMPTY = \{[^}]*\bid:\s*""/.test(src), true);
  check("A. edit mode derives from form.id", /const isEditMode = Boolean\(form\.id\)/.test(src), true);

  section("B — Button label follows edit mode (existing state, no duplicates)");
  check(
    "B. label renders Update in edit mode, Save otherwise",
    /\{\s*saving \? "Saving\.\.\." : isEditMode \? "Update" : "Save"\s*\}/.test(src),
    true
  );
  check("B. no second edit-state variable introduced", (src.match(/const\s+(isEditMode|isEditing)\s*=/g) || []).length, 1);

  section("C — Edit loads the employee; Update uses the update path");
  check("C. edit handler sets id from the row", /id:\s*row\.id \|\| row\.employeeId/.test(src), true);
  check("C. submit branches on isEditMode", /if\s*\(\s*isEditMode\s*\)/.test(src), true);
  check("C. update path calls updateEmployee(form.id", /updateEmployee\(form\.id,/.test(src), true);
  check("C. create path calls createEmployee(payload", /createEmployee\(payload/.test(src), true);
  check("C. employee ID preserved from the loaded form", /employeeId:\s*\n?\s*employeeType && form\.employeeId/.test(src), true);
  check("C. success notification kept", /Employee updated successfully\. Employee ID/.test(src), true);
  check("C. list refreshed after save", /await refreshEmployees\(\)/.test(src), true);

  section("D — Reset/Cancel restore Save");
  check(
    "D. Reset in edit mode reloads a fresh form (id cleared)",
    /if\s*\(\s*isEditMode\s*\)\s*\{\s*await prepareNewForm\(\);/.test(src),
    true
  );
  check("D. fresh form spreads EMPTY (falsy id)", /\.\.\.EMPTY,\s*\n?\s*employeeId:/.test(src), true);
  check("D. Cancel keeps existing onBack behavior", /onClick=\{onBack\}>\s*\n?\s*Cancel/.test(src), true);

  section("E — Nothing else changed");
  check("E. Scale of Pay 12 options intact", (src.match(/<option>\d{5}-\d{5,6} \((IS-\d|Level-\d)\)<\/option>/g) || []).length, 12);
  check("E. no backend/API import changes", /from "\.\.\/utils\/employeeApi"/.test(src), true);

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
