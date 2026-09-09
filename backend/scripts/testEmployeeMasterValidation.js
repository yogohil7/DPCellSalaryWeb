require("dotenv").config();
const { connectDB } = require("../db");
const {
  validateAndBuildPay,
} = require("../routes/employees");

/* Re-require module internals via fresh require of validators by duplicating checks */
function validateEmployeeCode(raw) {
  const code = String(raw || "").trim();
  if (!code) return { error: "Employee ID is required." };
  if (!/^\d+$/.test(code) || !code.startsWith("2001")) {
    return { error: "Employee ID must be numeric and must start with 2001." };
  }
  if (code.length < 8 || code.length > 10) {
    return { error: "Employee ID must be numeric and must start with 2001." };
  }
  return { code };
}

function validateBank(raw) {
  if (raw == null || String(raw).trim() === "") return { value: null };
  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    return { error: "Bank Account Number must contain only numeric characters." };
  }
  return { value };
}

(async () => {
  await connectDB();

  console.log("ID ABC20010001:", validateEmployeeCode("ABC20010001").error);
  console.log("ID 10010001:", validateEmployeeCode("10010001").error);
  console.log("ID 20010001:", validateEmployeeCode("20010001").code);

  console.log("Bank 1234567890:", validateBank("1234567890").value);
  console.log("Bank 1234ABC:", validateBank("1234ABC567").error);
  console.log("Bank 1234-5678:", validateBank("1234-5678").error);

  const fix = await validateAndBuildPay({ employeeType: "FIX" });
  console.log("FIX pay:", fix);

  const regular = await validateAndBuildPay({
    employeeType: "REGULAR",
    payLevel: 1,
    payMatrixCellNo: 2,
  });
  console.log("REGULAR L1C2:", regular);

  const fakeBasic = await validateAndBuildPay({
    employeeType: "REGULAR",
    payLevel: 1,
    payMatrixCellNo: 2,
    basicPay: 50000,
  });
  console.log("Ignores client basicPay 50000 →", fakeBasic.basicPay);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
