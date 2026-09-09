/**
 * checkDatabase.js — READ ONLY diagnostic for SQL error 4060.
 *
 * Creates nothing, changes nothing, drops nothing.
 * Connects to master with the configured credentials and reports:
 *   - which databases actually exist on DB_SERVER
 *   - the state of each (ONLINE / OFFLINE / RESTORING ...)
 *   - whether the configured login can open DB_DATABASE
 *   - the exact GRANT statement to run if access is the problem
 *
 * Usage:  cd backend && node scripts/checkDatabase.js
 */

const path = require("path");
const sql = require("mssql/msnodesqlv8");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env"),
    override: true
});

const DB_SERVER = (process.env.DB_SERVER || "").trim();
const DB_DATABASE = (process.env.DB_DATABASE || "").trim();
const DB_PORT = (process.env.DB_PORT || "").trim();
const DB_USER = (process.env.DB_USER || "").trim();
const DB_PASSWORD = process.env.DB_PASSWORD || "";

const server = DB_PORT ? `${DB_SERVER},${DB_PORT}` : DB_SERVER;
const auth =
    DB_USER && DB_PASSWORD
        ? `Uid=${DB_USER};Pwd=${DB_PASSWORD};`
        : `Trusted_Connection=Yes;`;

function connStr(database) {
    return (
        `Driver={ODBC Driver 18 for SQL Server};` +
        `Server=${server};Database=${database};` +
        auth +
        `Encrypt=No;TrustServerCertificate=Yes;`
    );
}

async function main() {
    console.log("=".repeat(64));
    console.log("SQL Server connection diagnostic (read only)");
    console.log("=".repeat(64));
    console.log(`Server        : ${server}`);
    console.log(`Configured DB : ${DB_DATABASE}`);
    console.log(
        `Authentication: ${DB_USER && DB_PASSWORD
            ? `SQL login "${DB_USER}"`
            : "Windows (Trusted_Connection)"}`
    );
    console.log("");

    let pool;
    try {
        pool = await sql.connect({ connectionString: connStr("master") });
        console.log("Connected to master OK\n");
    } catch (error) {
        console.error("Could not connect to master either.");
        console.error(error.message);
        console.error(
            "\nThis is a server/login problem, not a database-name problem:" +
            "\n  - Is the SQL Server service running?" +
            `\n  - Is the instance name "${server}" correct?` +
            "\n  - Is the login allowed to connect at all?"
        );
        process.exit(1);
    }

    const who = await pool.request().query(
        "SELECT SUSER_SNAME() AS LoginName, ORIGINAL_LOGIN() AS OriginalLogin"
    );
    const loginName = who.recordset[0].LoginName;
    console.log(`Connected as  : ${loginName}`);
    console.log(`Original login: ${who.recordset[0].OriginalLogin}\n`);

    const collation = await pool.request().query(
        "SELECT SERVERPROPERTY('Collation') AS ServerCollation"
    );
    const serverCollation = collation.recordset[0].ServerCollation;
    const caseSensitive = /_CS_/i.test(String(serverCollation));
    console.log(`Server collation: ${serverCollation}`);
    if (caseSensitive) {
        console.log(
            "  WARNING: this collation is CASE SENSITIVE, so the database" +
            "\n  name in .env must match the real name letter for letter."
        );
    }
    console.log("");

    const dbs = await pool.request().query(`
        SELECT
            name,
            state_desc,
            user_access_desc,
            is_read_only,
            HAS_DBACCESS(name) AS HasAccess
        FROM sys.databases
        ORDER BY name
    `);

    console.log("Databases on this server:");
    console.log("-".repeat(64));
    for (const row of dbs.recordset) {
        const access =
            row.HasAccess === 1
                ? "accessible"
                : row.HasAccess === 0
                    ? "NO ACCESS"
                    : "unknown";
        console.log(
            `  ${String(row.name).padEnd(28)} ${String(row.state_desc).padEnd(12)} ${access}`
        );
    }
    console.log("");

    const exact = dbs.recordset.find((r) => r.name === DB_DATABASE);
    const caseInsensitive = dbs.recordset.find(
        (r) => String(r.name).toLowerCase() === DB_DATABASE.toLowerCase()
    );

    console.log("=".repeat(64));
    console.log("Diagnosis");
    console.log("=".repeat(64));

    if (!caseInsensitive) {
        console.log(
            `No database named "${DB_DATABASE}" exists on ${server}.` +
            "\nPick the correct name from the list above and set it in" +
            "\nbackend/.env as DB_DATABASE. Do not create a new database" +
            "\nunless you are certain none of the listed ones is the project DB."
        );
        await pool.close();
        return;
    }

    if (!exact) {
        console.log(
            `The name differs only by letter case:` +
            `\n  .env has : ${DB_DATABASE}` +
            `\n  server has: ${caseInsensitive.name}`
        );
        console.log(
            caseSensitive
                ? "\nThe server collation is case sensitive, so this IS the cause" +
                  "\nof error 4060. Set DB_DATABASE to the exact name above."
                : "\nThe server collation is case insensitive, so this alone is not" +
                  "\nthe cause, but matching the exact name is still recommended."
        );
    }

    const target = exact || caseInsensitive;

    if (target.state_desc !== "ONLINE") {
        console.log(
            `\nDatabase "${target.name}" is ${target.state_desc}, not ONLINE.` +
            "\nThat alone produces error 4060. Bring it online in SSMS:" +
            `\n  ALTER DATABASE [${target.name}] SET ONLINE;`
        );
    }

    if (target.user_access_desc !== "MULTI_USER") {
        console.log(
            `\nDatabase "${target.name}" is in ${target.user_access_desc} mode.` +
            "\nThat also produces error 4060 for other connections:" +
            `\n  ALTER DATABASE [${target.name}] SET MULTI_USER;`
        );
    }

    if (target.HasAccess === 0) {
        console.log(
            `\nLogin "${loginName}" has NO access to "${target.name}".` +
            "\nThis is the cause of error 4060. Run this in SSMS as an" +
            "\nadministrator (it grants access, it does not touch any data):" +
            "\n" +
            `\n  USE [${target.name}];` +
            `\n  CREATE USER [${loginName}] FOR LOGIN [${loginName}];` +
            `\n  ALTER ROLE db_owner ADD MEMBER [${loginName}];`
        );
    } else if (target.HasAccess === 1 && target.state_desc === "ONLINE") {
        console.log(
            `\nLogin "${loginName}" CAN open "${target.name}" and it is ONLINE.`
        );
        try {
            const probe = await sql.connect({
                connectionString: connStr(target.name)
            });
            const t = await probe
                .request()
                .query(
                    "SELECT DB_NAME() AS CurrentDb, COUNT(*) AS TableCount FROM sys.tables"
                );
            console.log(
                `Direct connection OK: ${t.recordset[0].CurrentDb}, ` +
                `${t.recordset[0].TableCount} tables.`
            );
            if (exact) {
                console.log(
                    "\nThe configuration in backend/.env is correct. If npm start" +
                    "\nstill reports 4060, a stale DB_DATABASE is set in your" +
                    "\nWindows environment and is overriding the file. Check with:" +
                    "\n  echo %DB_DATABASE%          (Command Prompt)" +
                    "\n  $env:DB_DATABASE            (PowerShell)"
                );
            }
            await probe.close();
        } catch (error) {
            console.log(`Direct connection still failed: ${error.message}`);
        }
    }

    await pool.close();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
