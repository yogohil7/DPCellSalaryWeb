/**
 * SALARY ENTRY UI — hidden rule warnings + Cheque Amount (2026-09-24).
 *
 *   1-3  CLA / rule warnings are not rendered; employees still load; real
 *        errors are still shown.
 *   4-7  Cheque Amount = Net Salary + Income Tax + Professional Tax
 *        (bill summary was showing Net Salary only).
 *   8    change is confined to Salary Entry.
 *
 * Static + unit checks only; touches no database.
 * Usage: cd backend && npm run test:salary-entry-cheque-amount
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const FRONT = path.join(ROOT, "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryEntry.jsx"), "utf8");
const calcSrc = fs.readFileSync(path.join(FRONT, "utils", "salaryBasicCalc.js"), "utf8");

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1; else failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

(async () => {
  const calc = await import("data:text/javascript;base64," + Buffer.from(calcSrc).toString("base64"));
  const { calculateChequeAmount } = calc;

  /* Get Data handler body, from the API call to its catch block. */
  const start = pageSrc.indexOf("const result = await getSalaryEntryEmployees(");
  const end = pageSrc.indexOf("CALCULATED EMPLOYEES", start);
  const getData = pageSrc.slice(start, end);

  console.log("TEST 1 - Get Data with CLA warnings still loads");
  check("rows are still read from result.data", /const rows = Array\.isArray\(result\?\.data\) \? result\.data : \[\];/.test(getData), true);
  check("employees are still set from the loaded rows", /setEmployees\(ordered\)/.test(getData), true);
  check("warnings do not abort the load (no throw on warnings)", /calcWarnings[\s\S]{0,200}throw/.test(getData), false);

  console.log("TEST 2 - CLA warning text is not rendered");
  check("no 'warning(s):' message is built", /warning\(s\)/.test(pageSrc), false);
  check("calcWarnings never reaches the message parts", /parts\.push\([^)]*calcWarnings/.test(getData), false);
  check("warnings only go to the console", /console\.debug\([^\n]*, calcWarnings\);/.test(getData), true);
  check("no CLA text in the page", /CLA rule not configured/.test(pageSrc), false);

  console.log("TEST 3 - real errors are still displayed");
  check("calculation errors still pushed to the message", /parts\.push\(\s*`\$\{calcErrors\.length\} calculation error\(s\)/.test(getData), true);
  check("API / load errors still shown from the catch", /catch \(error\) \{[\s\S]{0,200}setGetDataMessage\(\s*error\.message \|\| "Unable to load employee salary data\."/.test(getData), true);
  check("locked / completed notices still shown", /Bill is locked \(read-only\)\./.test(getData) && /Bill is completed \(read-only\)\./.test(getData), true);
  check("the message is still rendered", /setGetDataMessage\(parts\.join\("\. "\)\)/.test(getData), true);

  console.log("TEST 4 - 60,512 + 0 + 200 = 60,712");
  check("cheque", calculateChequeAmount({ netSalary: 60512, incomeTax: 0, professionalTax: 200 }), 60712);
  check("Indian format", (60712).toLocaleString("en-IN", { minimumFractionDigits: 2 }), "60,712.00");

  console.log("TEST 5 - 60,512 + 500 + 200 = 61,212");
  check("cheque", calculateChequeAmount({ netSalary: 60512, incomeTax: 500, professionalTax: 200 }), 61212);
  check("numeric, not string concatenation", calculateChequeAmount({ netSalary: "60512", incomeTax: "500", professionalTax: "200" }), 61212);

  console.log("TEST 6 - no IT / PT -> Cheque = Net");
  check("cheque = net", calculateChequeAmount({ netSalary: 60512, incomeTax: 0, professionalTax: 0 }), 60512);
  check("blank / null values treated as 0", calculateChequeAmount({ netSalary: 60512, incomeTax: null, professionalTax: "" }), 60512);

  console.log("TEST 7 - no double counting");
  check("other deductions ignored (GPF, NPS, other)", calculateChequeAmount({ netSalary: 1000, incomeTax: 10, professionalTax: 20, gpfSubscription: 999, nps: 999, otherDeduction: 999, grossAmount: 99999 }), 1030);
  check("professionTax spelling accepted, not added twice", calculateChequeAmount({ netSalary: 1000, incomeTax: 10, professionalTax: 20, professionTax: 20 }), 1030);
  check("summary Cheque Amount uses Net + IT + PT totals",
    /const summaryChequeAmount = calculateChequeAmount\(\{\s*netSalary: totals\.netSalary,\s*incomeTax: totals\.incomeTax,\s*professionalTax: totals\.professionTax,\s*\}\);/.test(pageSrc), true);
  const box = pageSrc.slice(pageSrc.lastIndexOf("Cheque Amount\n"), pageSrc.lastIndexOf("Cheque Amount\n") + 400);
  check("Cheque Amount box renders summaryChequeAmount", /money\(\s*summaryChequeAmount\s*\)/.test(box), true);
  check("Cheque Amount box no longer renders totals.netSalary", /totals\.netSalary/.test(box), false);
  check("per-employee cheque uses the same formula", /const chequeAmount = calculateChequeAmount\(\{\s*netSalary,\s*incomeTax,\s*professionalTax: professionTax,\s*\}\);/.test(pageSrc), true);
  check("Net Salary itself unchanged (gross - total deduction)", /const netSalary = grossAmount - totalDeduction;/.test(pageSrc), true);
  /* Summary equals the sum of per-employee cheque amounts. */
  const emps = [{ n: 60512, it: 0, pt: 200 }, { n: 45000.5, it: 500, pt: 200 }, { n: 30000, it: 0, pt: 0 }];
  const perEmp = emps.reduce((s, e) => s + calculateChequeAmount({ netSalary: e.n, incomeTax: e.it, professionalTax: e.pt }), 0);
  const summary = calculateChequeAmount({ netSalary: emps.reduce((s, e) => s + e.n, 0), incomeTax: 500, professionalTax: 400 });
  check("summary = sum of employee cheque amounts", summary, perEmp);

  console.log("TEST 8 - change confined to Salary Entry");
  const git = (args) => execSync(`git ${args}`, { cwd: ROOT }).toString();
  check("shared cheque formula file untouched", git("status --short -- frontend/src/utils/salaryBasicCalc.js").trim(), "");
  /*
     backend/routes/salaryCalculate.js legitimately changed on 2026-09-25
     for the Retirement-Based GPF/NPS Deduction Stop Rule (a real, requested
     change to the central salary calculation path) — a bare git-diff
     tripwire on the whole file would now false-positive on any future
     legitimate change to it forever. The actual invariant this test cares
     about — the Cheque Amount formula itself is untouched — is asserted on
     content instead, exactly like every other check in this file, and is
     independently proven again (including under the retirement rule) by
     backend/scripts/testRetirementGpfNpsStop.js.
  */
  check(
    "backend Cheque Amount formula (calculateForEmployee) still calls calculateChequeAmount({netSalary, incomeTax, professionalTax}) verbatim",
    /const chequeAmount = calculateChequeAmount\(\{\s*\n\s*netSalary,\s*\n\s*incomeTax,\s*\n\s*professionalTax,\s*\n\s*\}\);/.test(
      fs.readFileSync(path.join(ROOT, "backend", "routes", "salaryCalculate.js"), "utf8")
    ),
    true
  );
  for (const f of ["frontend/src/pages/AccountOfficerBills.jsx", "frontend/src/pages/FinalSalaryBill.jsx", "frontend/src/pages/ChequeRegister.jsx",
    "frontend/src/pages/SalaryRegister.jsx", "frontend/src/pages/BankCopy.jsx", "backend/routes/chequeRegister.js", "backend/routes/salaryRegister.js",
    "backend/routes/bankCopy.js", "backend/routes/salaryBillApproval.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    check(`${f} does not use the Salary Entry summary`, /summaryChequeAmount|from "\.\/SalaryEntry"/.test(src), false);
  }
  check("backend warnings are still generated (not deleted)", /warnings\.push\(`Employee \$\{employeeId\}: \$\{w\}`\)/.test(fs.readFileSync(path.join(ROOT, "backend", "routes", "salaryEntry.js"), "utf8")), true);

  console.log(`\nPassed: ${passed}    Failed: ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
