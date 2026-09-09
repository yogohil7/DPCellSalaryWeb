const path = require("path");
const sql = require("mssql/msnodesqlv8");

/*
  Load backend/.env explicitly.

  Why __dirname and not the default:
    require("dotenv").config() resolves ".env" from process.cwd(), so the
    settings silently disappeared whenever the app was started from anywhere
    other than the backend folder.

  Why override: true:
    dotenv does NOT overwrite variables that already exist in process.env.
    A stale machine-level or shell-level DB_DATABASE therefore won out over
    this file, which is how a database name that is not in .env can end up in
    the connection request (and produce SQL error 4060).
*/
require("dotenv").config({
    path: path.join(__dirname, ".env"),
    override: true
});

const DB_SERVER = (process.env.DB_SERVER || "").trim();
const DB_DATABASE = (process.env.DB_DATABASE || "").trim();
const DB_PORT = (process.env.DB_PORT || "").trim();
const DB_USER = (process.env.DB_USER || "").trim();
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_ENCRYPT = (process.env.DB_ENCRYPT || "").trim();
const DB_TRUST_SERVER_CERTIFICATE =
    (process.env.DB_TRUST_SERVER_CERTIFICATE || "").trim();

function isYes(value, defaultYes) {
    if (!value) return defaultYes;
    return /^(1|y|yes|true)$/i.test(value);
}

/* Server=HOST,PORT only when a port is configured (named instances use the name). */
function serverPart() {
    return DB_PORT ? `${DB_SERVER},${DB_PORT}` : DB_SERVER;
}

/*
  Authentication mode is decided by configuration, not hard-coded:
    - DB_USER + DB_PASSWORD present -> SQL Server authentication
    - otherwise                     -> Windows authentication (existing behaviour)
*/
function buildConnectionString(databaseName) {
    const auth =
        DB_USER && DB_PASSWORD
            ? `Uid=${DB_USER};Pwd=${DB_PASSWORD};`
            : `Trusted_Connection=Yes;`;

    return (
        `Driver={ODBC Driver 18 for SQL Server};` +
        `Server=${serverPart()};` +
        `Database=${databaseName};` +
        auth +
        `Encrypt=${isYes(DB_ENCRYPT, true) ? "Yes" : "No"};` +
        `TrustServerCertificate=${isYes(DB_TRUST_SERVER_CERTIFICATE, true) ? "Yes" : "No"};`
    );
}

const dbConfig = {
    connectionString: buildConnectionString(DB_DATABASE)
};

/* Same string against master — used only to diagnose a failed connection. */
const masterConfig = {
    connectionString: buildConnectionString("master")
};

function describeConfig() {
    return [
        `  DB_SERVER   = ${DB_SERVER || "(not set)"}`,
        `  DB_DATABASE = ${DB_DATABASE || "(not set)"}`,
        `  DB_PORT     = ${DB_PORT || "(not set — default instance)"}`,
        `  Auth        = ${DB_USER && DB_PASSWORD
            ? `SQL login "${DB_USER}"`
            : "Windows (Trusted_Connection)"}`,
        `  Encrypt     = ${isYes(DB_ENCRYPT, true) ? "Yes" : "No"}`,
        `  TrustServerCertificate = ${isYes(DB_TRUST_SERVER_CERTIFICATE, true) ? "Yes" : "No"}`,
        `  .env file   = ${path.join(__dirname, ".env")}`
    ].join("\n");
}

async function connectDB() {
    if (!DB_SERVER || !DB_DATABASE) {
        console.error("SQL Server configuration is incomplete:");
        console.error(describeConfig());
        throw new Error(
            "DB_SERVER and DB_DATABASE must be set in backend/.env"
        );
    }

    try {
        console.log("Connecting to SQL Server...");
        console.log(`  Server:   ${serverPart()}`);
        console.log(`  Database: ${DB_DATABASE}`);

        await sql.connect(dbConfig);

        console.log("SQL Server connected successfully");

        return true;
    } catch (error) {
        console.error("SQL Server connection failed:");
        console.error(error.message);
        console.error("\nConfiguration actually used:");
        console.error(describeConfig());

        if (/\b4060\b/.test(error.message) ||
            /Cannot open database/i.test(error.message)) {
            console.error(
                "\nSQL error 4060 — the server was reached, but the login could not" +
                `\nopen database "${DB_DATABASE}". Usual causes:` +
                "\n  1. The database does not exist under that exact name." +
                "\n  2. The database is OFFLINE, RESTORING or in single-user mode." +
                "\n  3. The login has no user mapped in that database." +
                "\nRun this to see the real names and your access:" +
                "\n  node scripts/checkDatabase.js"
            );
        }

        throw error;
    }
}

module.exports = {
    sql,
    connectDB
};
