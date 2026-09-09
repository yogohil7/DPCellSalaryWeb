import { useEffect, useMemo, useState } from "react";
import {
  getSectionSummary,
  downloadSectionSummaryExcel,
} from "../utils/sectionSummaryApi";
import { getChequeRegisterMeta } from "../utils/chequeRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./sectionSummary.css";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* The five printed columns, in order. Exports read these too. */
const COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "section", label: "SECTION" },
  { key: "instituteCount", label: "INSTITUTE" },
  { key: "employeeCount", label: "EMPLOYEE" },
  { key: "chequeAmount", label: "CHEQUE AMOUNT" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* dd-MMM-yyyy, the way the printed report shows a date. */
function formatReportDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")}-${short[m - 1]}-${y}`;
}

export default function SectionSummary({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [years, setYears] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [table, setTable] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

  /*
     Cheque No. and Date belong to this report's own view state. Editing them
     never touches a salary, approval or workflow record — the report only
     reads approved data.
  */
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState(todayIso());

  useEffect(() => {
    let active = true;
    getChequeRegisterMeta()
      .then((res) => {
        if (!active) return;
        setSections(res?.data?.sections || []);
        setYears(res?.data?.years || []);
      })
      .catch(() => {
        if (active) {
          setSections([]);
          setYears([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = report?.rows || [];

  /*
     Screen, CSV, PDF, Copy and Print all read this one array, already in the
     server's final order with its Sr. No., plus the same Total line the table
     foot prints. Nothing is re-sorted or re-numbered here.
  */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => ({
      ...row,
      chequeAmount: money(row.chequeAmount),
    }));
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        srNo: "Total",
        section: "",
        instituteCount: report.total.instituteCount,
        employeeCount: report.total.employeeCount,
        chequeAmount: money(report.total.chequeAmount),
      },
    ];
  }, [rows, report]);

  const filters = { month, year, sectionId: sectionId || undefined, table };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getSectionSummary(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage("No approved salary bills found for the selected month.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Section Summary.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadSectionSummaryExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="ss-page">
      <div className="ss-toolbar no-print">
        <button type="button" className="ss-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="ss-filters no-print" onSubmit={handleShow}>
        <div className="ss-field">
          <label>Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">All Sections</option>
            {sections
              .filter((s) => s.sectionId != null)
              .map((section) => (
                <option key={section.sectionId} value={section.sectionId}>
                  {section.sectionName}
                </option>
              ))}
          </select>
        </div>

        <div className="ss-field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="ss-field">
          <label>Year</label>
          {years.length ? (
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          )}
        </div>

        <div className="ss-field">
          <label>Salary Type</label>
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
          </select>
        </div>

        <button type="submit" className="ss-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="ss-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="ss-sheet">
          <div className="ss-head">
            <div className="ss-head-line">{report.heading}</div>
            <div className="ss-head-line">{report.monthLine}</div>
            <div className="ss-head-line">{report.subHeading}</div>
          </div>

          <div className="ss-table-wrap">
            <table className="ss-table">
              <thead>
                <tr>
                  <th className="ss-c-sr">Sr_No.</th>
                  <th className="ss-c-section">SECTION</th>
                  <th className="ss-c-num">INSTITUTE</th>
                  <th className="ss-c-num">EMPLOYEE</th>
                  <th className="ss-c-amt">CHEQUE AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.srNo}-${row.section}`}>
                    <td className="ss-c-sr">{row.srNo}</td>
                    <td className="ss-c-section">{row.section}</td>
                    <td className="ss-c-num">{row.instituteCount}</td>
                    <td className="ss-c-num">{row.employeeCount}</td>
                    <td className="ss-c-amt">{money(row.chequeAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ss-c-sr">Total</td>
                  <td className="ss-c-section" />
                  <td className="ss-c-num">{report.total.instituteCount}</td>
                  <td className="ss-c-num">{report.total.employeeCount}</td>
                  <td className="ss-c-amt">{money(report.total.chequeAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="ss-words">
            Amount In Word :- {report.amountInWords}
          </div>

          {/*
             Cheque No. and Date are this report's own fields. Typing in them
             changes nothing in the salary, approval or workflow tables.
          */}
          <div className="ss-cheque">
            <label className="ss-cheque-field">
              <span>CHEQUE NO. :</span>
              <input
                type="text"
                className="ss-cheque-input no-print"
                value={chequeNo}
                maxLength={40}
                onChange={(e) => setChequeNo(e.target.value)}
              />
              <span className="ss-cheque-print">{chequeNo}</span>
            </label>

            <label className="ss-cheque-field">
              <span>DATE :</span>
              <input
                type="date"
                className="ss-cheque-input no-print"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
              <span className="ss-cheque-print">{formatReportDate(chequeDate)}</span>
            </label>
          </div>

          <div className="ss-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="ss-actions no-print">
            <GridToolbar
              title="Section Summary"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="ss-actions-main">
              <button
                type="button"
                className="ss-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button type="button" className="ss-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
