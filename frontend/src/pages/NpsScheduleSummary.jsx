import { useEffect, useMemo, useState } from "react";
import {
  getNpsSchedule,
  downloadNpsScheduleExcel,
} from "../utils/npsScheduleApi";
import { getEmployeeWiseSalaryMeta } from "../utils/employeeWiseSalaryApi";
import { listInstitutes } from "../utils/instituteApi";
import { GridToolbar } from "../components/DataGrid";
import "./npsScheduleSummary.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

function money(value) {
  const n = Number(value || 0);
  if (n === 0) return "0";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateText(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB");
}

/* Today, as the date input wants it. The letter date defaults to today and
   the officer may change it before printing; it is never stored. */
function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* A manual, print-only value: blank prints as a rule the officer writes on. */
function blankLine(value) {
  const text = String(value == null ? "" : value).trim();
  return text === "" ? "__________" : text;
}

/* dd-mm-yyyy for the letter; blank stays a blank line. */
function letterDate(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "__________";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : text;
}

/* The schedule's printed columns, mirroring the departmental schedule. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "instituteCode", label: "Code No." },
  { key: "instituteName", label: "Institute Name" },
  { key: "billMonth", label: "Bill Month" },
  { key: "billType", label: "Bill Type" },
  { key: "scheduleNo", label: "Schedule No." },
  { key: "employeeCount", label: "Count" },
  { key: "amount", label: "Amount" },
];

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export default function NpsScheduleSummary({ onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("npsScheduleSummary");
  const [sections, setSections] = useState([]);
  const [institutes, setInstitutes] = useState([]);
  const [years, setYears] = useState([]);

  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [billType, setBillType] = useState("REGULAR");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, instituteList] = await Promise.all([
          getEmployeeWiseSalaryMeta(),
          listInstitutes(),
        ]);
        if (cancelled) return;
        const metaData = meta?.data || {};
        setSections((metaData.sections || []).filter((s) => s.sectionId != null));
        const yearList = (metaData.years || []).map(String);
        setYears(yearList.length ? yearList : [String(new Date().getFullYear())]);
        const rows = Array.isArray(instituteList)
          ? instituteList
          : instituteList?.data || [];
        setInstitutes(rows);
      } catch (error) {
        if (!cancelled) setMessage(error.message || "Could not load the filters.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleInstitutes = useMemo(() => {
    if (!sectionId) return institutes;
    return institutes.filter(
      (i) => String(i.sectionId ?? i.SectionId ?? "") === String(sectionId)
    );
  }, [institutes, sectionId]);

  /*
     Letter state. These four values do NOT exist in the database — there is no
     cheque or challan column anywhere in the schema — so they are collected
     here purely to print, are never sent to any API, and are never saved.
  */
  const [showLetter, setShowLetter] = useState(false);
  const [letterDateValue, setLetterDateValue] = useState(todayIso());
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    /* A schedule covers exactly one salary month, so there is no
       all-months option here. */
    () => ({ sectionId, instituteCode, month, year, billType }),
    [sectionId, instituteCode, month, year, billType]
  );

  async function handleShow(event) {
    if (event) event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await getNpsSchedule(filters);
      setReport(response?.data || null);
      if (!response?.data?.rows?.length) {
        setMessage("No NPS schedule records found for the selected criteria.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the NPS Schedule Summary.");
    } finally {
      setLoading(false);
    }
  }

  /*
    This page is a REPORT. It does not create, save, generate or revise NPS
    schedules — there is no save handler, no save API call and no save state.
    The saved-schedule tables and any existing saved data are untouched.
  */

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      /* Same filters object the screen used, so the file matches the table. */
      await downloadNpsScheduleExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handlePrint() {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    requestAnimationFrame(() => {
      printReport("npsScheduleSummary");
    });
  }

  const rows = report?.rows || [];

  const exportRows = useMemo(
    () =>
      rows.map((row) => ({
        srNo: row.srNo,
        instituteCode: row.instituteCode,
        instituteName: row.instituteName,
        billMonth: row.billMonth,
        billType: row.billType,
        scheduleNo: row.scheduleNo,
        employeeCount: row.employeeCount,
        amount: money(row.amount),
      })),
    [rows]
  );

  return (
    <div className="nsch-page">
      <div className="nsch-toolbar no-print">
        <button type="button" className="nsch-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="nsch-filters no-print" onSubmit={handleShow}>
        <div className="nsch-field">
          <label htmlFor="nsch-section">SECTION</label>
          <select
            id="nsch-section"
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setInstituteCode("");
            }}
          >
            <option value="">All Sections</option>
            {sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.sectionName}
              </option>
            ))}
          </select>
        </div>

        <div className="nsch-field nsch-field-wide">
          <label htmlFor="nsch-institute">INSTITUTE</label>
          <select
            id="nsch-institute"
            value={instituteCode}
            onChange={(e) => setInstituteCode(e.target.value)}
          >
            <option value="">All Institutes</option>
            {visibleInstitutes.map((i) => {
              const code = i.instituteCode ?? i.InstituteCode;
              const name = i.instituteName ?? i.InstituteName ?? code;
              return (
                <option key={code} value={code}>
                  {code} - {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="nsch-field">
          <label htmlFor="nsch-month">SALARY MONTH</label>
          <div className="nsch-month-pair">
            <select
              id="nsch-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="nsch-field">
          <label htmlFor="nsch-bill-type">BILL TYPE</label>
          <select
            id="nsch-bill-type"
            value={billType}
            onChange={(e) => setBillType(e.target.value)}
          >
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">OLD Salary only</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
            <option value="ALL">All</option>
          </select>
        </div>

        <div className="nsch-field nsch-field-action">
          <button type="submit" className="nsch-btn primary" disabled={loading}>
            {loading ? "Loading..." : "Show"}
          </button>
        </div>
      </form>

      {message ? <div className="nsch-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="nsch-sheet">
          <div className="nsch-head">
            <div className="nsch-head-line">{report.heading}</div>
            <div className="nsch-head-line nsch-head-title">{report.subHeading}</div>
            <div className="nsch-head-line">{report.purposeLine}</div>
          </div>

          <div className="nsch-meta">
            <div>
              <span>Salary Month</span>
              <strong>{report.salaryMonthLabel || "—"}</strong>
            </div>
            <div>
              <span>Bill Type</span>
              <strong>{report.billType}</strong>
            </div>
            <div>
              <span>Schedule Date</span>
              <strong>
                {report.saved ? dateText(report.scheduleDate) : dateText(new Date())}
              </strong>
            </div>
            {report.saved ? (
              <div>
                <span>Schedule No.</span>
                <strong>
                  {report.scheduleNo} (rev {report.revisionNo})
                </strong>
              </div>
            ) : null}
          </div>

          {report.saved ? (
            <div className="nsch-snapshot no-print">
              Saved snapshot — these are the values stored on{" "}
              {dateText(report.createdAt)}, not current salary data.
            </div>
          ) : null}

          <div className="nsch-table-wrap">
            <table className="nsch-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={
                        c.key === "amount" || c.key === "employeeCount"
                          ? "nsch-n"
                          : ""
                      }
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.instituteCode}-${row.srNo}`}>
                    <td className="nsch-c">{row.srNo}</td>
                    <td className="nsch-c">{row.instituteCode}</td>
                    <td className="nsch-l">{row.instituteName}</td>
                    <td className="nsch-c">{row.billMonth}</td>
                    <td className="nsch-c">{row.billType}</td>
                    <td className="nsch-c">{row.scheduleNo || "—"}</td>
                    <td className="nsch-n">{row.employeeCount}</td>
                    <td className="nsch-n">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="nsch-c nsch-bold" colSpan={6}>
                    Total
                  </td>
                  <td className="nsch-n nsch-bold">
                    {report.totals.employeeCount}
                  </td>
                  <td className="nsch-n nsch-bold">{money(report.totals.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="nsch-sign">
            <div className="nsch-sign-box">
              <div className="nsch-sign-line" />
              <div>Prepared By</div>
            </div>
            <div className="nsch-sign-box">
              <div className="nsch-sign-line" />
              <div>Checked By</div>
            </div>
            <div className="nsch-sign-box">
              <div className="nsch-sign-line" />
              <div>Approved By</div>
            </div>
          </div>

          <div className="nsch-actions no-print">
            <GridToolbar
              reportName="npsScheduleSummary"
              title="NPS Schedule Summary"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print", "pdf"]}
            />
            <div className="nsch-actions-main">
              <button
                type="button"
                className="nsch-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
              <button
                type="button"
                className="nsch-btn"
                onClick={() => setShowLetter((open) => !open)}
              >
                {showLetter ? "Hide NPS Letter" : "NPS Letter"}
              </button>
              <button type="button" className="nsch-btn" onClick={handlePrint}>
                PDF
              </button>
              <button type="button" className="nsch-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {report && showLetter ? (
        <div className="nsch-letter-wrap">
          {/*
             Print-only inputs. None of these four values exists in the
             database, so they are collected here and used for nothing but
             rendering this letter. They are never sent to an API and never
             saved.
          */}
          <div className="nsch-letter-inputs no-print">
            <div className="nsch-letter-inputs-note">
              Print only — not saved to the database.
            </div>
            <div className="nsch-letter-fields">
              <div className="nsch-field">
                <label>Letter Date</label>
                <input
                  type="date"
                  value={letterDateValue}
                  onChange={(e) => setLetterDateValue(e.target.value)}
                />
              </div>
              <div className="nsch-field">
                <label>Cheque No.</label>
                <input
                  type="text"
                  value={chequeNo}
                  onChange={(e) => setChequeNo(e.target.value)}
                  placeholder="(blank prints a rule)"
                />
              </div>
              <div className="nsch-field">
                <label>Cheque Date</label>
                <input
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                />
              </div>
              <div className="nsch-field">
                <label>Challan No.</label>
                <input
                  type="text"
                  value={challanNo}
                  onChange={(e) => setChallanNo(e.target.value)}
                  placeholder="(blank prints a rule)"
                />
              </div>
              <div className="nsch-field">
                <label>Challan Date</label>
                <input
                  type="date"
                  value={challanDate}
                  onChange={(e) => setChallanDate(e.target.value)}
                />
              </div>
              <button type="button" className="nsch-btn" onClick={handlePrint}>
                Print Letter
              </button>
            </div>
          </div>

          <div className="nsch-letter">
            <div className="nsch-letter-from">
              <div>નં હસબ/ડી.પી/ન.વ.પે.યો./</div>
              <div>નિયામક સમાજ સુરક્ષાની કચેરી</div>
              <div>બ્લોક નં-૧૬,ગ્રાઉન્ડ ફ્લોર ,</div>
              <div>ડો.જીવરાજ મેહતા ભવન.</div>
              <div>જુના સચિવાલય,ગાંધીનગર.</div>
              <div>તા- {letterDate(letterDateValue)}</div>
              <div>ફોન નં-૨૩૨૫૬૩૧૨/૫૬૩૧૩</div>
            </div>

            <div className="nsch-letter-to">
              <div>પ્રતિ,</div>
              <div>મેનેજર શ્રી,</div>
              <div>સ્ટેટ બેંક ઓફ ઇન્ડિયા,</div>
              <div>મૅઈન બ્રાન્ચ,</div>
              <div>ગાંધીનગર</div>
            </div>

            <div className="nsch-letter-subject">
              વિષય : માહે {report.letter?.monthLabel || "—"} પગારમાંથી નવવર્ધિત
              પેન્શન યોજના અંગે ની કપાત રકમ મોકલાવવા બાબત .
            </div>

            {/*
               The amount is report.letter.amount — the same figure the table
               foots — and its Gujarati words come from the backend, so the
               letter can never state a different sum from the report.
            */}
            <div className="nsch-letter-body">
              ઉપરોક્ત વિષય અનુસંધાને જણાવવાનું કે અત્રે ની કચેરી માંથી માહે{" "}
              {report.letter?.monthLabel || "—"} ના પગારનું ચુકવણું ચેક નં:-{" "}
              {blankLine(chequeNo)} તા: {letterDate(chequeDate)} જેમાં NPS ની
              કપાત રકમ નીચે દર્શાવેલ ચલણ નં- {blankLine(challanNo)} તા.{" "}
              {letterDate(challanDate)} મુજબ રૂ. {report.letter?.amountGujarati}/-{" "}
              {report.letter?.amountInWordsGujarati} જે સાથે ચેક નં.{" "}
              {blankLine(chequeNo)}, તા. {letterDate(chequeDate)} થી જમા કરવા
              મોકલાવી આપીએ છીએ તે જમા કરવા વિનંતિ છે.
            </div>

            <div className="nsch-letter-sign">
              <div>નિયામક</div>
              <div>સમાજ સુરક્ષા, ગાંધીનગર</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
