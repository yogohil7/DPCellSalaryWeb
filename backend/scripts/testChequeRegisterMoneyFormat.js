/**
 * Cheque Register amount formatting — plain figures, no commas, no ".00".
 *
 *   1,47,800.00 -> 147800 | 2,53,104 -> 253104 | 88,680.00 -> 88680
 *   0.00 -> 0 | 1,200.50 -> 1200.50 | -5,000.00 -> -5000
 *
 * Rule (mirrors money() in frontend/src/pages/ChequeRegister.jsx, the single
 * function feeding screen cells, TOTAL row and exportRows for CSV/PDF/Copy/
 * Print): no thousands separators; integers render with 0 fraction digits,
 * non-integers with exactly 2 (rounded). Signs and values are untouched —
 * display only.
 *
 * Runs offline. Usage: cd backend && npm run test:cheque-money
 */

const fs = require("fs");
const path = require("path");

const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "ChequeRegister.jsx"),
  "utf8"
);

/* Exact mirror of money() in ChequeRegister.jsx. */
function money(value) {
  const n = Number(value || 0);
  const fractionDigits = Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  });
}

const REQUIRED_KEYS = [
  "basic", "gradePay", "totalPay", "da", "hra", "cla", "medical",
  "specialAllowance", "ta", "grossAmount", "gpfAmount", "nps",
  "incomeTax", "professionalTax", "otherDeductions", "netAmount",
  "chequeAmount",
];

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
  console.log("Cheque Register money format — plain figures, no commas");
  console.log("=".repeat(72));

  section("A — Page uses the plain-figure formatter");
  check(
    "A. money() branches on Number.isInteger",
    /const fractionDigits = Number\.isInteger\(n\) \? 0 : 2/.test(pageSrc),
    true
  );
  check("A. thousands separators disabled", /useGrouping:\s*false/.test(pageSrc), true);
  check("A. no forced minimumFractionDigits: 2", /minimumFractionDigits:\s*2,?\s*\n?\s*maximumFractionDigits:\s*2/.test(pageSrc), false);
  check("A. rounding cap stays at 2 decimals", /maximumFractionDigits:\s*2/.test(pageSrc), true);

  section("B — Integers: no commas, no .00");
  check("B. 147800 -> 147800", money(147800), "147800");
  check("B. 0 -> 0", money(0), "0");
  check("B. null -> 0", money(null), "0");
  check("B. 88680 -> 88680", money(88680), "88680");
  check("B. 253104 -> 253104", money(253104), "253104");
  check("B. 218536 -> 218536", money(218536), "218536");

  section("C — Paise preserved, no commas");
  check("C. 1200.50 -> 1200.50", money(1200.5), "1200.50");
  check("C. 1200.25 -> 1200.25", money(1200.25), "1200.25");
  check("C. 99.9 -> 99.90", money(99.9), "99.90");

  section("D — Negatives, no grouping, rounding");
  check("D. -5000 -> -5000", money(-5000), "-5000");
  check("D. -1200.5 -> -1200.50", money(-1200.5), "-1200.50");
  check("D. 1234567 -> 1234567 (no grouping)", money(1234567), "1234567");
  check("D. 1200.256 rounds to 1200.26", money(1200.256), "1200.26");
  check(
    "D. no commas in any formatted sample",
    [147800, 0, 88680, 218536, 1200.5, -5000, 1234567].every((v) => !money(v).includes(",")),
    true
  );

  section("E — All monetary columns + totals flow through money()");
  const keysBlock = pageSrc.slice(pageSrc.indexOf("const MONEY_KEYS"), pageSrc.indexOf("];", pageSrc.indexOf("const MONEY_KEYS")) + 2);
  check(
    "E. MONEY_KEYS covers every required column",
    REQUIRED_KEYS.every((k) => keysBlock.includes(`"${k}"`)),
    true
  );
  check("E. body cells use money()", /<td key=\{key\} className="cr-num">\s*\n?\s*\{money\(row\[key\]\)\}/.test(pageSrc), true);
  check("E. TOTAL row uses money()", /\{money\(totals\[key\]\)\}/.test(pageSrc), true);
  check("E. export rows use money() (CSV/PDF/Copy)", (pageSrc.match(/money\((row|totals)\[key\]\)/g) || []).length >= 3, true);

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
