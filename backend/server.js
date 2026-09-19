const express = require("express");
const cors = require("cors");

const { connectDB, sql } = require("./db");
const authRoutes = require("./routes/auth");
const salaryBillCodeRoutes = require("./routes/salaryBillCodes");
const medicalAllowanceMasterRoutes = require("./routes/medicalAllowanceMaster");
const transportAllowanceMasterRoutes =
    require("./routes/transportAllowanceMaster");
const {
    authenticate,
    requirePermissionPrefix,
    requireRoles,
    requireJwtSecret,
} = require("./middleware/auth");

const app = express();

/*
  CORS — configuration, not a literal.

  CORS_ORIGIN holds a comma-separated allowlist, e.g.
    CORS_ORIGIN=http://localhost:5173
  Development keeps working unchanged because that is the documented default
  in .env.example. Production names its real origin without a code edit.

  Deliberately NOT a wildcard and NOT origin reflection: only origins on the
  list are accepted. Requests with no Origin header (curl, server-to-server,
  same-origin) are allowed through, which is how the browser behaves anyway.
*/
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/*
  SAME-ORIGIN WITHOUT A HARD-CODED ADDRESS.

  The browser reaches this API through the IIS reverse proxy:

      browser -> http://<server>/api/...  ->  IIS  ->  http://127.0.0.1:5000/api/...

  That is a SAME-ORIGIN call from the browser's point of view, so CORS is not
  protecting anything there. The problem is that a browser still sends an
  Origin header on POST, and the old rule only accepted an origin that was
  literally listed in CORS_ORIGIN. A change of the server's LAN address
  therefore broke every POST with an opaque 500 (a rejected origin is thrown,
  and this app has no global error handler).

  The rules below decide from the REQUEST itself instead of from a fixed
  address, so no LAN IP appears here and none is needed in the environment.
  Explicitly configured origins still work, so the Vite dev server on :5173
  is unaffected.

  Credentials are deliberately NOT enabled: this API authenticates with a
  Bearer token in the Authorization header, never a cookie. Reflecting the
  request origin is therefore safe and carries none of the wildcard-plus-
  credentials risk.
*/

/** The host the BROWSER addressed, not the loopback address IIS proxies to. */
function browserFacingHost(req) {
    const forwarded = String(req.headers["x-forwarded-host"] || "")
        .split(",")[0]
        .trim();
    return forwarded || String(req.headers.host || "").trim();
}

/** The host part of an Origin header value, or "" when it cannot be parsed. */
function hostOfOrigin(origin) {
    try {
        return new URL(String(origin)).host;
    } catch (_) {
        return "";
    }
}

/** True when the TCP peer is this machine - i.e. the local IIS proxy. */
function arrivedOverLoopback(req) {
    const addr = String((req.socket && req.socket.remoteAddress) || "");
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

const CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const CORS_ALLOWED_HEADERS = ["Content-Type", "Authorization"];

function corsOptionsFor(req, callback) {
    const base = {
        methods: CORS_METHODS,
        allowedHeaders: CORS_ALLOWED_HEADERS
    };
    const allow = () => callback(null, Object.assign({}, base, { origin: true }));

    const origin = req.headers.origin;

    /* 1. No Origin: curl, server-to-server, most same-origin GETs. Unchanged. */
    if (!origin) return allow();

    /* 2. An explicitly configured origin. Unchanged, so a separately hosted
          client keeps working exactly as before. */
    if (CORS_ORIGINS.includes(origin)) return allow();

    /* 3. Same origin: the Origin names the very host this request was
          addressed to. True for every browser call through IIS, whatever the
          server's address happens to be today. */
    const originHost = hostOfOrigin(origin);
    if (originHost && originHost === browserFacingHost(req)) return allow();

    /* 4. The request arrived over the loopback interface, which on this
          deployment means the IIS reverse proxy on this same machine
          forwarded it. This covers the default ARR behaviour of replacing the
          Host header with 127.0.0.1:5000 without sending X-Forwarded-Host, in
          which case rule 3 cannot see the browser's host. A remote client
          cannot forge a loopback source address. Enabling ARR's "Preserve
          client Host header" makes rule 3 do the work and reduces this to an
          unused fallback. */
    if (arrivedOverLoopback(req)) return allow();

    return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

app.use(cors(corsOptionsFor));

app.use(express.json());

app.use("/api/auth", authRoutes);

/* Authenticated API surface — login itself stays public. */
const authed = [authenticate];

app.use("/api/dashboard", ...authed, requirePermissionPrefix("DASHBOARD"), require("./routes/dashboard"));

app.use("/api/salary-bill-codes", ...authed, requirePermissionPrefix("MASTER_SALARY_BILL_CODE", "SALARY_ENTRY"), salaryBillCodeRoutes);
app.use("/api/sections", ...authed, requirePermissionPrefix("MASTER_SECTION"), require("./routes/sections"));
app.use("/api/districts", ...authed, requirePermissionPrefix("MASTER_INSTITUTE", "MASTER_DISTRICT", "MASTER_EMPLOYEE"), require("./routes/districts"));
app.use("/api/institutes", ...authed, requirePermissionPrefix("MASTER_INSTITUTE"), require("./routes/institutes"));
app.use("/api/designations", ...authed, requirePermissionPrefix("MASTER_DESIGNATION"), require("./routes/designations"));
app.use("/api/pay-revisions", ...authed, requirePermissionPrefix("MASTER_PAY_REVISION"), require("./routes/payRevisions"));
app.use("/api/pay-matrix", ...authed, requirePermissionPrefix("MASTER_PAY_MATRIX"), require("./routes/payMatrix"));
app.use("/api/employees", ...authed, requirePermissionPrefix("MASTER_EMPLOYEE"), require("./routes/employees"));
app.use("/api/salary-components", ...authed, requirePermissionPrefix("MASTER_SALARY_COMPONENT"), require("./routes/salaryComponents"));
app.use("/api/salary", ...authed, requirePermissionPrefix("SALARY_CALCULATION", "SALARY_ENTRY"), require("./routes/salaryCalculate"));
app.use("/api/salary-entry", ...authed, requirePermissionPrefix("SALARY_ENTRY"), require("./routes/salaryEntry"));
app.use("/api/salary-variation", ...authed, requirePermissionPrefix("SALARY_VARIATION", "REPORT_VARIATION"), require("./routes/salaryVariation"));
app.use("/api/salary-bill", ...authed, requirePermissionPrefix("SALARY_FINAL_BILL"), require("./routes/finalSalaryBill"));
/*
  This router hosts BOTH the Account Officer's approval queue AND the
  Auditor's "Returning Salary Bills" queue (GET /returned).

  Gating the whole router on ACCOUNT_OFFICER made every Auditor request to
  /returned fail with "You do not have permission to perform this action."
  AUDITOR is admitted here, and every approval action inside the router
  carries its own accountOfficerOnly guard, so an Auditor still cannot
  verify, lock, approve, return or reject anything.
*/
app.use(
  "/api/salary-bill-approval",
  ...authed,
  requireRoles("ACCOUNT_OFFICER", "AUDITOR"),
  require("./routes/salaryBillApproval")
);
app.use("/api/cheque-register", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/chequeRegister"));
app.use("/api/bank-copy", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/bankCopy"));
app.use("/api/section-summary", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/sectionSummary"));
app.use("/api/gpf-summary", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/gpfSummary"));
app.use("/api/employee-wise-salary", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/employeeWiseSalary"));
app.use("/api/employee-pay-slip", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/employeePaySlip"));
app.use("/api/salary-register", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/salaryRegister"));
app.use("/api/income-tax-professional-tax", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/incomeTaxProfessionalTax"));
app.use("/api/institute-wise-salary", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/instituteWiseSalary"));
app.use("/api/nps-summary", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/npsSummary"));
app.use("/api/nps-gpf-deduction", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/npsGpfDeduction"));
app.use("/api/employee-report", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/employeeReport"));
app.use("/api/nps-schedule", ...authed, requirePermissionPrefix("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"), require("./routes/npsSchedule"));
app.use("/api/employee-payroll-config", ...authed, requirePermissionPrefix("MASTER_PAYROLL_CONFIG", "MASTER_EMPLOYEE"), require("./routes/employeePayrollConfig"));
app.use("/api/da-master", ...authed, requirePermissionPrefix("MASTER_DA"), require("./routes/daMaster"));
app.use("/api/hra-master", ...authed, requirePermissionPrefix("MASTER_HRA"), require("./routes/hraMaster"));
app.use("/api/cla-master", ...authed, requirePermissionPrefix("MASTER_CLA"), require("./routes/claMaster"));
app.use("/api/medical-allowance-master", ...authed, requirePermissionPrefix("MASTER_MEDICAL_ALLOWANCE"), medicalAllowanceMasterRoutes);
app.use("/api/transport-allowance-master", ...authed, requirePermissionPrefix("MASTER_TRANSPORT_ALLOWANCE"), transportAllowanceMasterRoutes);
app.use("/api/da-difference", ...authed, requirePermissionPrefix("DA_DIFFERENCE_ENTRY", "MASTER_DA_DIFFERENCE"), require("./routes/daDifference"));
app.use("/api/employee-increment", ...authed, requirePermissionPrefix("MASTER_INCREMENT", "SALARY_ENTRY"), require("./routes/employeeIncrement"));
app.use("/api/users", ...authed, requirePermissionPrefix("MASTER_USER"), require("./routes/users"));
app.use("/api/roles", ...authed, requirePermissionPrefix("MASTER_ROLE_PERMISSION"), require("./routes/roles"));


const PORT = Number(process.env.PORT) || 5000;

app.get("/", (req, res) => {
    res.json({
        message: "DP Cell Salary Management API is running"
    });
});

async function ensureSalaryBillCodeSchema() {
    const check = await sql.query`
      SELECT
        OBJECT_ID(N'dbo.SalaryBillCodes', N'U') AS TableId,
        CASE WHEN EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
            AND name = N'UQ_SalaryBillCodes_Period_Category_Type'
        ) THEN 1 ELSE 0 END AS HasOldPeriodKey,
        CASE WHEN EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
            AND name = N'UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type'
        ) THEN 1 ELSE 0 END AS HasBillMonthPeriodKey
    `;

    const row = check.recordset[0] || {};
    if (!row.TableId) return;
    if (row.HasBillMonthPeriodKey && !row.HasOldPeriodKey) {
        return;
    }

    console.warn(
      "SalaryBillCodes BillMonth uniqueness migration is required. Applying..."
    );

    const { spawnSync } = require("child_process");
    const path = require("path");
    const script = path.join(__dirname, "scripts", "applySalaryBillMonthUnique.js");
    const result = spawnSync(process.execPath, [script], {
        cwd: __dirname,
        encoding: "utf8",
        stdio: "inherit",
    });

    if (result.status !== 0) {
        console.warn(
            "SalaryBillCodes BillMonth uniqueness migration failed (non-fatal)."
        );
    }
}

async function startServer() {
    try {
        /*
          Fail fast and visibly if the JWT secret is missing or weak. This runs
          before anything else so the process never serves a request while
          signing tokens with an unconfigured secret. The value is never logged.
        */
        requireJwtSecret();

        await connectDB();
        try {
            const { ensureAdminUser } = require("./utils/ensureAdminUser");
            await ensureAdminUser();
        } catch (adminErr) {
            console.warn("[ensureAdmin] skipped:", adminErr.message);
        }
        await ensureSalaryBillCodeSchema();
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(
                __dirname,
                "scripts",
                "applySalaryBillApprovalWorkflow.js"
            );
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn(
                    "SalaryBillCodes approval workflow migration warning (non-fatal)."
                );
            }
        } catch (migErr) {
            console.warn("Approval workflow migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(
                __dirname,
                "scripts",
                "applySalaryBillInstituteWorkflow.js"
            );
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn(
                    "SalaryBillInstituteWorkflow migration warning (non-fatal)."
                );
            }
        } catch (migErr) {
            console.warn("Institute workflow migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applySalaryEntrySnapshot.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("SalaryEmployeeDetails snapshot migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("Snapshot migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(
                __dirname,
                "scripts",
                "applySalaryEmployeeDetailHistory.js"
            );
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("Salary employee history migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("Salary employee history migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applySalaryInstituteLockAndMonthFinalization.js");
            const result = spawnSync(process.execPath, [script], { cwd: __dirname, encoding: "utf8", stdio: "inherit" });
            if (result.status !== 0) console.warn("Institute lock migration warning (non-fatal).");
        } catch (migErr) { console.warn("Institute lock migration skipped:", migErr.message); }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applySalaryEntryCLA.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("SalaryEmployeeDetails CLA migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("CLA migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applySalaryEntryBasicRates.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("SalaryEmployeeDetails BasicRates migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("BasicRates migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applyDADifferenceAndIncrement.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("DA Difference / Increment migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("DA Difference migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applyDADifferenceNPS.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("DA Difference NPS migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("DA Difference NPS migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applyRoleBasedAccess.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("Role-based access migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("Role-based access migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applyBillNoDate.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("BillNo/BillDate migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("BillNo/BillDate migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applyDADifferenceMonthLock.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("DA Difference Month Lock migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("DA Difference Month Lock migration skipped:", migErr.message);
        }
        try {
            const { spawnSync } = require("child_process");
            const path = require("path");
            const script = path.join(__dirname, "scripts", "applySalaryBillCodesArchive.js");
            const result = spawnSync(process.execPath, [script], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: "inherit",
            });
            if (result.status !== 0) {
                console.warn("SalaryBillCodes IsArchived migration warning (non-fatal).");
            }
        } catch (migErr) {
            console.warn("SalaryBillCodes IsArchived migration skipped:", migErr.message);
        }

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Salary Bill Codes: http://localhost:${PORT}/api/salary-bill-codes`);
        });

    } catch (error) {
        console.error(
            "Server could not start because SQL Server connection failed.",
            error
        );

        process.exit(1);
    }
}

startServer();
