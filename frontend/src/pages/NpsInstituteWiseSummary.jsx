import { useEffect, useMemo, useState } from "react";
import {
  getNpsInstituteWiseSummary,
  downloadNpsInstituteWiseExcel,
} from "../utils/npsInstituteWiseApi";
import { listActiveSections } from "../utils/sectionApi";
import { GridToolbar } from "../components/DataGrid";
import "./npsInstituteWise.css";

/* Whole rupees, as the printed report shows them. */
function amount(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* The nine printed columns. Exports read these too. */
const COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "code", label: "Code No." },
  { key: "instituteName", label: "Institute Name" },
  { key: "month", label: "Month" },
  { key: "type", label: "Type" },
  { key: "total", label: "Total" },
  { key: "nps", label: "N.P.S." },
  { key: "amount", label: "Amount" },
];

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/* dd-mm-yyyy, the format the printed report uses. */
function formatReportDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export default function NpsInstituteWiseSummary({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [salaryTime, setSalaryTime] = useState("1");
  const [salaryType, setSalaryType] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

  /* Report-level fields. Typing here changes no salary record. */
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");

  /* Current year and the previous five. */
  const years = useMemo(() => {
    const y = now.getFullYear();
    return [0, 1, 2, 3, 4, 5].map((n) => String(y - n));
  }, [now]);

  useEffect(() => {
    let active = true;
    listActiveSections()
      .then((rows) => {
        if (!active) return;
        const list = (Array.isArray(rows) ? rows : [])
          .map((r) => ({ id: r.sectionId ?? r.id, name: r.sectionName || "" }))
          .filter((r) => r.id != null && r.name);
        setSections(list);
        /* Default = the first section in the master list. */
        if (list.length) setSectionId(String(list[0].id));
      })
      .catch(() => {
        if (active) setSections([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getNpsInstituteWiseSummary({
        sectionId,
        month,
        year,
        salaryTime,
        salaryType,
      });
      setReport(res?.data || null);
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the NPS Institute Wise Summary.");
    } finally {
      setLoading(false);
    }
  }

  const rows = report?.rows || [];

  /*
     Screen, CSV, PDF, Copy and Print all read this one array, already in the
     server's order with its Sr. No., plus the same TOTAL line the table foot
     prints. Nothing is re-sorted or re-numbered here.
  */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => ({
      ...row,
      nps: amount(row.nps),
      amount: amount(row.amount),
    }));
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        srNo: "TOTAL",
        code: "",
        instituteName: "",
        month: "",
        type: "",
        total: report.total.total,
        nps: amount(report.total.nps),
        amount: amount(report.total.amount),
      },
    ];
  }, [rows, report]);

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadNpsInstituteWiseExcel({ sectionId, month, year, salaryTime, salaryType });
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="npsiw-page">
      <div className="npsiw-toolbar no-print">
        <button type="button" className="npsiw-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="npsiw-filters no-print" onSubmit={handleShow}>
        <div className="npsiw-field">
          <label htmlFor="npsiw-section">Section</label>
          <select
            id="npsiw-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">All Sections</option>
            {sections.map((s2) => (
              <option key={s2.id} value={s2.id}>
                {s2.name}
              </option>
            ))}
          </select>
        </div>

        <div className="npsiw-field">
          <label htmlFor="npsiw-month">Month</label>
          <select
            id="npsiw-month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="npsiw-field">
          <label htmlFor="npsiw-year">Year</label>
          <select
            id="npsiw-year"
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

        <div className="npsiw-field">
          <label htmlFor="npsiw-time">Salary Time</label>
          <select
            id="npsiw-time"
            value={salaryTime}
            onChange={(e) => setSalaryTime(e.target.value)}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>

        <div className="npsiw-field">
          <label htmlFor="npsiw-salary-type">Salary Type</label>
          <select
            id="npsiw-salary-type"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
          </select>
        </div>

        <button type="submit" className="npsiw-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="npsiw-message no-print">{message}</div> : null}

      {report ? (
        <div className="npsiw-sheet">
          <div className="npsiw-head">
            <div className="npsiw-head-line">{report.sectionTitle}</div>
            <div className="npsiw-head-line">{report.heading}</div>
            <div className="npsiw-head-line">{report.monthLine}</div>
            <div className="npsiw-head-line">{report.subHeading}</div>
          </div>

          <div className="npsiw-cheque">
            <div className="npsiw-cheque-field">
              <span>Cheque No:-</span>
              <input
                type="text"
                className="npsiw-cheque-input"
                value={chequeNo}
                maxLength={40}
                onChange={(e) => setChequeNo(e.target.value)}
              />
              <span className="npsiw-cheque-print">{chequeNo}</span>
            </div>
            <div className="npsiw-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="npsiw-cheque-input"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
              <span className="npsiw-cheque-print">{formatReportDate(chequeDate)}</span>
            </div>
            <div className="npsiw-cheque-field">
              <span>Challan No:-</span>
              <input
                type="text"
                className="npsiw-cheque-input"
                value={challanNo}
                maxLength={40}
                onChange={(e) => setChallanNo(e.target.value)}
              />
              <span className="npsiw-cheque-print">{challanNo}</span>
            </div>
            <div className="npsiw-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="npsiw-cheque-input"
                value={challanDate}
                onChange={(e) => setChallanDate(e.target.value)}
              />
              <span className="npsiw-cheque-print">{formatReportDate(challanDate)}</span>
            </div>
          </div>

          <div className="npsiw-table-wrap">
            <table className="npsiw-table">
              <thead>
                <tr>
                  <th className="npsiw-c-sr">Sr_No.</th>
                  <th className="npsiw-c-code">Code No.</th>
                  <th className="npsiw-c-name">Institute Name</th>
                  <th className="npsiw-c-month">Month</th>
                  <th className="npsiw-c-type">Type</th>
                  <th className="npsiw-c-total">Total</th>
                  <th className="npsiw-c-amt">N.P.S.</th>
                  <th className="npsiw-c-amt">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="npsiw-empty" colSpan={8}>
                      No NPS records found for the selected criteria.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.srNo}-${row.code}`}>
                      <td className="npsiw-c-sr">{row.srNo}</td>
                      <td className="npsiw-c-code">{row.code}</td>
                      <td className="npsiw-c-name">{row.instituteName}</td>
                      <td className="npsiw-c-month">{row.month}</td>
                      <td className="npsiw-c-type">{row.type}</td>
                      <td className="npsiw-c-total">{row.total}</td>
                      <td className="npsiw-c-amt">{amount(row.nps)}</td>
                      <td className="npsiw-c-amt">{amount(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td className="npsiw-c-sr" colSpan={5}>
                      TOTAL
                    </td>
                    <td className="npsiw-c-total">{report.total.total}</td>
                    <td className="npsiw-c-amt">{amount(report.total.nps)}</td>
                    <td className="npsiw-c-amt">{amount(report.total.amount)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <div className="npsiw-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar,Gujarat State</div>
          </div>
        </div>
      ) : null}

      {report && rows.length > 0 ? (
        <div className="npsiw-actions no-print">
          <GridToolbar
            title="NPS Institute Wise Summary"
            columns={COLUMNS}
            rows={exportRows}
            showSearch={false}
            hiddenActions={["excel", "print"]}
          />
          <div className="npsiw-actions-main">
            <button
              type="button"
              className="npsiw-btn"
              onClick={handleExcel}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Excel"}
            </button>
            <button
              type="button"
              className="npsiw-btn"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
