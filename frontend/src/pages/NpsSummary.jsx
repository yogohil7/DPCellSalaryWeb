import { useEffect, useMemo, useState } from "react";
import { getNpsSummary, downloadNpsSummaryExcel } from "../utils/npsSummaryApi";
import { getChequeRegisterMeta } from "../utils/chequeRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./npsSummary.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* The six printed columns, in order. Exports read these too. */
const COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "name", label: "NAME" },
  { key: "emp", label: "EMP" },
  { key: "nps", label: "N.P.S." },
  { key: "amount", label: "Amount" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* dd-mm-yyyy, the format the printed report uses. */
function formatReportDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export default function NpsSummary({ user, onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("npsSummary");
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [years, setYears] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

  /*
     Cheque / Chalan number and dates belong to this report's own view state.
     They start blank, the user types them before printing, and editing them
     never touches a salary, approval or workflow record.
  */
  const [salaryTime, setSalaryTime] = useState("1");
  const [salaryType, setSalaryType] = useState("ALL");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [chalanNo, setChalanNo] = useState("");
  const [chalanDate, setChalanDate] = useState("");

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
      nps: money(row.nps),
      amount: money(row.amount),
    }));
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        srNo: "Total",
        name: "",
        emp: report.total.emp,
        nps: money(report.total.nps),
        amount: money(report.total.amount),
      },
    ];
  }, [rows, report]);

  const filters = { month, year, sectionId: sectionId || undefined, salaryTime, salaryType };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getNpsSummary(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage("No NPS records found for the selected criteria.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the NPS Summary.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadNpsSummaryExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    printReport("npsSummary");
  }

  return (
    <div className="nps-page">
      <div className="nps-toolbar no-print">
        <button type="button" className="nps-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="nps-filters no-print" onSubmit={handleShow}>
        <div className="nps-field">
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

        <div className="nps-field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="nps-field">
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

        <div className="nps-field">
          <label htmlFor="nps-time">Salary Time</label>
          <select
            id="nps-time"
            value={salaryTime}
            onChange={(e) => setSalaryTime(e.target.value)}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>

        <div className="nps-field">
          <label htmlFor="nps-salary-type">Salary Type</label>
          <select
            id="nps-salary-type"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
          </select>
        </div>

        <button type="submit" className="nps-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="nps-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="nps-sheet">
          <div className="nps-head">
            <div className="nps-head-line">{report.sectionTitle}</div>
            <div className="nps-head-line">{report.heading}</div>
            <div className="nps-head-line">{report.monthLine}</div>
            <div className="nps-head-line">{report.subHeading}</div>
          </div>

          {/*
             Cheque / Chalan fields sit above the table, as on the printed
             form. Typing here changes nothing in the salary tables.
          */}
          <div className="nps-cheque">
            <label className="nps-cheque-field">
              <span>Cheque No:-</span>
              <input
                type="text"
                className="nps-cheque-input no-print"
                value={chequeNo}
                maxLength={40}
                onChange={(e) => setChequeNo(e.target.value)}
              />
              <span className="nps-cheque-print">{chequeNo}</span>
            </label>

            <label className="nps-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="nps-cheque-input no-print"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
              <span className="nps-cheque-print">{formatReportDate(chequeDate)}</span>
            </label>

            <label className="nps-cheque-field">
              <span>Chalan No:-</span>
              <input
                type="text"
                className="nps-cheque-input no-print"
                value={chalanNo}
                maxLength={40}
                onChange={(e) => setChalanNo(e.target.value)}
              />
              <span className="nps-cheque-print">{chalanNo}</span>
            </label>

            <label className="nps-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="nps-cheque-input no-print"
                value={chalanDate}
                onChange={(e) => setChalanDate(e.target.value)}
              />
              <span className="nps-cheque-print">{formatReportDate(chalanDate)}</span>
            </label>
          </div>

          <div className="nps-table-wrap">
            <table className="nps-table">
              <thead>
                <tr>
                  <th className="nps-c-sr">Sr. No.</th>
                  <th className="nps-c-name">NAME</th>
                  <th className="nps-c-emp">EMP</th>
                  <th className="nps-c-amt">N.P.S.</th>
                  <th className="nps-c-amt">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.srNo}-${row.name}`}>
                    <td className="nps-c-sr">{row.srNo}</td>
                    <td className="nps-c-name">{row.name}</td>
                    <td className="nps-c-emp">{row.emp}</td>
                    <td className="nps-c-amt">{money(row.nps)}</td>
                    <td className="nps-c-amt">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="nps-c-sr">Total</td>
                  <td className="nps-c-name" />
                  <td className="nps-c-emp">{report.total.emp}</td>
                  <td className="nps-c-amt">{money(report.total.nps)}</td>
                  <td className="nps-c-amt">{money(report.total.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="nps-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="nps-actions no-print">
            <GridToolbar
              reportName="npsSummary"
              subtitle={[report.sectionTitle, report.heading, report.monthLine, report.subHeading]}
              title="NPS Summary"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="nps-actions-main">
              <button
                type="button"
                className="nps-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button type="button" className="nps-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
