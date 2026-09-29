/**
 * BUSINESS RULE (2026-09-24, follow-up to migration 48): Bill No. / Bill
 * Date / NPS Schedule No. are per-Bill-Month-instance, stored in the new
 * dbo.SalaryEntryBillHeader table (migration 49), keyed by
 * (SalaryBillCodeId, InstituteCode, BillMonth). A JUL-2026 bill and an
 * AUG-2026 bill for the SAME AUG-2026 salary data must keep their own
 * header values and never overwrite each other.
 *
 * dbo.SalaryBillInstituteWorkflow is untouched by this table — it stays
 * exactly one row per (SalaryBillCodeId, InstituteCode), still the single
 * source of truth for approval/submit/return/lock status.
 *
 * This is exactly the scenario from the ticket's own required test A–D:
 *   A. AUG-2026 salary + JUL-2026 bill: BillNo=729, BillDate=20-08-2026,
 *      NPS=SCH/JUL/TEST. Save Draft.
 *   B. Same salary, AUG-2026 bill: BillNo=849, BillDate=03-09-2026,
 *      NPS=SCH/AUG/TEST. Save Draft.
 *   C. Reopen JUL-2026 -> still 729 / 20-08-2026 / SCH/JUL/TEST.
 *   D. Reopen AUG-2026 -> still 849 / 03-09-2026 / SCH/AUG/TEST.
 *
 * Runs offline: the database layer is stubbed, no SQL Server needed.
 *
 * Usage:  cd backend && node scripts/testSalaryEntryBillHeader.js
 */

const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */

const MASTER = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
};
const BILLS = [MASTER];

const HEADERS = [];
let headerIdSeq = 0;

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");

  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    if (/WHERE BillCode = \?/i.test(text)) {
      return Promise.resolve({
        recordset: BILLS.filter((b) => b.BillCode === String(values[0])),
      });
    }
    return Promise.resolve({ recordset: BILLS.slice() });
  }

  if (/INSERT INTO dbo\.SalaryEntryBillHeader/i.test(text)) {
    headerIdSeq += 1;
    const [billCodeId, instituteCode, billMonth, billNo, billDate, npsScheduleNo] = values;
    HEADERS.push({
      HeaderId: headerIdSeq,
      SalaryBillCodeId: billCodeId,
      InstituteCode: instituteCode,
      BillMonth: billMonth,
      BillNo: billNo,
      BillDate: billDate,
      NPSScheduleNo: npsScheduleNo,
    });
    return Promise.resolve({ recordset: [] });
  }

  if (/UPDATE dbo\.SalaryEntryBillHeader/i.test(text)) {
    const [billNo, billDate, npsScheduleNo, , headerId] = values;
    const row = HEADERS.find((h) => h.HeaderId === headerId);
    if (row) {
      row.BillNo = billNo;
      row.BillDate = billDate;
      row.NPSScheduleNo = npsScheduleNo;
    }
    return Promise.resolve({ recordset: [] });
  }

  if (/SELECT TOP 1 \* FROM dbo\.SalaryEntryBillHeader/i.test(text)) {
    const [billCodeId, instituteCode, billMonth] = values;
    const row = HEADERS.find(
      (h) =>
        h.SalaryBillCodeId === billCodeId &&
        h.InstituteCode === instituteCode &&
        h.BillMonth === billMonth
    );
    return Promise.resolve({ recordset: row ? [row] : [] });
  }

  return Promise.resolve({ recordset: [] });
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: { query, Request: function R() { return { query, input() { return this; } }; } },
  connectDB: async () => true,
};

/* ===================== MODULE UNDER TEST ===================== */

const {
  getSalaryEntryBillHeader,
  upsertSalaryEntryBillHeader,
} = require("../utils/salaryEntryBillHeader");
const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

const BILL_CODE_ID = 1018; // AUG-2026
const INSTITUTE = "DDRS-16";

async function main() {
  console.log("=".repeat(72));
  console.log("Salary Entry: per-Bill-Month header (Bill No. / Bill Date / NPS Schedule No.)");
  console.log("=".repeat(72));

  section("TEST A — AUG-2026 salary + JUL-2026 bill: no header exists yet, then Save Draft");

  const beforeJul = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "JUL-2026");
  check("A. no JUL-2026 header exists yet", beforeJul, null);

  await upsertSalaryEntryBillHeader(null, {
    billCodeId: BILL_CODE_ID,
    instituteCode: INSTITUTE,
    billMonth: "JUL-2026",
    billNo: "729",
    billDate: "2026-08-20",
    npsScheduleNo: "SCH/JUL/TEST",
    actor: { fullName: "TESTER" },
  });
  const julHeader = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "JUL-2026");
  check("A. JUL-2026 header saved: Bill No.", julHeader?.BillNo, "729");
  check("A. JUL-2026 header saved: Bill Date", julHeader?.BillDate, "2026-08-20");
  check("A. JUL-2026 header saved: NPS Schedule No.", julHeader?.NPSScheduleNo, "SCH/JUL/TEST");
  check("A. exactly one header row exists so far", HEADERS.length, 1);

  section("TEST B — same salary, AUG-2026 bill: Save Draft must NOT touch the JUL-2026 row");

  await upsertSalaryEntryBillHeader(null, {
    billCodeId: BILL_CODE_ID,
    instituteCode: INSTITUTE,
    billMonth: "AUG-2026",
    billNo: "849",
    billDate: "2026-09-03",
    npsScheduleNo: "SCH/AUG/TEST",
    actor: { fullName: "TESTER" },
  });
  check("B. a SECOND header row was created (coexistence), not an overwrite", HEADERS.length, 2);

  const julAfterB = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "JUL-2026");
  check("B. JUL-2026 header is completely unchanged by the AUG-2026 save", julAfterB, {
    HeaderId: 1,
    SalaryBillCodeId: BILL_CODE_ID,
    InstituteCode: INSTITUTE,
    BillMonth: "JUL-2026",
    BillNo: "729",
    BillDate: "2026-08-20",
    NPSScheduleNo: "SCH/JUL/TEST",
  });

  section("TEST C — reopen JUL-2026: must return the JUL-2026 header, not the AUG-2026 one");

  const reopenJul = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "JUL-2026");
  check("C. Bill No.", reopenJul?.BillNo, "729");
  check("C. Bill Date", reopenJul?.BillDate, "2026-08-20");
  check("C. NPS Schedule No.", reopenJul?.NPSScheduleNo, "SCH/JUL/TEST");

  section("TEST D — reopen AUG-2026: must return the AUG-2026 header, not the JUL-2026 one");

  const reopenAug = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "AUG-2026");
  check("D. Bill No.", reopenAug?.BillNo, "849");
  check("D. Bill Date", reopenAug?.BillDate, "2026-09-03");
  check("D. NPS Schedule No.", reopenAug?.NPSScheduleNo, "SCH/AUG/TEST");

  section("TEST E — re-saving JUL-2026 again (correction) updates ONLY the JUL-2026 row, in place");

  await upsertSalaryEntryBillHeader(null, {
    billCodeId: BILL_CODE_ID,
    instituteCode: INSTITUTE,
    billMonth: "JUL-2026",
    billNo: "729-A",
    billDate: "2026-08-21",
    npsScheduleNo: "SCH/JUL/TEST-2",
    actor: { fullName: "TESTER" },
  });
  check("E. still exactly two header rows (updated, not a third insert)", HEADERS.length, 2);
  const julUpdated = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "JUL-2026");
  check("E. JUL-2026 row reflects the correction", julUpdated?.BillNo, "729-A");
  const augUnaffected = await getSalaryEntryBillHeader(BILL_CODE_ID, INSTITUTE, "AUG-2026");
  check("E. AUG-2026 row is untouched by the JUL-2026 correction", augUnaffected?.BillNo, "849");

  section("TEST F — a different institute's header never collides with DDRS-16's");

  const otherInstitute = await getSalaryEntryBillHeader(BILL_CODE_ID, "DDRS-10", "JUL-2026");
  check("F. no header exists for a different institute at the same bill+month", otherInstitute, null);

  section("TEST G — Salary data (the resolved bill) is the SAME for both Bill Month instances");

  const resolvedForJul = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "JUL-2026", salaryMonth: "AUG-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  const resolvedForAug = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "AUG-2026", salaryMonth: "AUG-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  check("G. the JUL-2026 bill instance resolves to the AUG-2026 master (same salary data)",
    resolvedForJul.bill.BillCodeId, BILL_CODE_ID);
  check("G. the AUG-2026 bill instance resolves to the SAME AUG-2026 master",
    resolvedForAug.bill.BillCodeId, BILL_CODE_ID);
  check("G. both instances share the identical resolved bill row",
    resolvedForJul.bill.BillCodeId === resolvedForAug.bill.BillCodeId, true);
  check("G. no second SalaryBillCodes row was ever created for this",
    BILLS.length, 1);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
