import { useEffect, useMemo, useState } from "react";
import {
  getInstituteWiseGpfSummary,
  downloadInstituteWiseGpfExcel,
} from "../utils/instituteWiseGpfApi";
import { listActiveSections } from "../utils/sectionApi";
import { GridToolbar } from "../components/DataGrid";
import "./instituteWiseGpf.css";

/* Whole rupees, as the legacy GPF report prints them. */
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
  { key: "gpf", label: "G.P.F." },
  { key: "gpfAdvance", label: "G.P.F.Adv" },
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

export default function InstituteWiseGpfSummary({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [salaryTime, setSalaryTime] = useState("1");
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
      const res = await getInstituteWiseGpfSummary({
        sectionId,
        month,
        year,
        salaryTime,
      });
      setReport(res?.data || null);
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the GPF Summary.");
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
      gpf: amount(row.gpf),
      gpfAdvance: amount(row.gpfAdvance),
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
        gpf: amount(report.total.gpf),
        gpfAdvance: amount(report.total.gpfAdvance),
        amount: amount(report.total.amount),
      },
    ];
  }, [rows, report]);

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadInstituteWiseGpfExcel({ sectionId, month, year, salaryTime });
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="iwg-page">
      <div className="iwg-toolbar no-print">
        <button type="button" className="iwg-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="iwg-filters no-print" onSubmit={handleShow}>
        <div className="iwg-field">
          <label htmlFor="iwg-section">Section</label>
          <select
            id="iwg-section"
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

        <div className="iwg-field">
          <label htmlFor="iwg-month">Month</label>
          <select
            id="iwg-month"
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

        <div className="iwg-field">
          <label htmlFor="iwg-year">Year</label>
          <select
            id="iwg-year"
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

        <div className="iwg-field">
          <label htmlFor="iwg-time">Salary Time</label>
          <select
            id="iwg-time"
            value={salaryTime}
            onChange={(e) => setSalaryTime(e.target.value)}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>

        <button type="submit" className="iwg-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="iwg-message no-print">{message}</div> : null}

      {report ? (
        <div className="iwg-sheet">
          <div className="iwg-head">
            <div className="iwg-head-line">{report.sectionTitle}</div>
            <div className="iwg-head-line">{report.heading}</div>
            <div className="iwg-head-line">{report.monthLine}</div>
            <div className="iwg-head-line">{report.subHeading}</div>
          </div>

          <div className="iwg-cheque">
            <div className="iwg-cheque-field">
              <span>Cheque No:-</span>
              <input
                type="text"
                className="iwg-cheque-input"
                value={chequeNo}
                maxLength={40}
                onChange={(e) => setChequeNo(e.target.value)}
              />
              <span className="iwg-cheque-print">{chequeNo}</span>
            </div>
            <div className="iwg-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="iwg-cheque-input"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
              <span className="iwg-cheque-print">{formatReportDate(chequeDate)}</span>
            </div>
            <div className="iwg-cheque-field">
              <span>Challan No:-</span>
              <input
                type="text"
                className="iwg-cheque-input"
                value={challanNo}
                maxLength={40}
                onChange={(e) => setChallanNo(e.target.value)}
              />
              <span className="iwg-cheque-print">{challanNo}</span>
            </div>
            <div className="iwg-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="iwg-cheque-input"
                value={challanDate}
                onChange={(e) => setChallanDate(e.target.value)}
              />
              <span className="iwg-cheque-print">{formatReportDate(challanDate)}</span>
            </div>
          </div>

          <div className="iwg-table-wrap">
            <table className="iwg-table">
              <thead>
                <tr>
                  <th className="iwg-c-sr">Sr_No.</th>
                  <th className="iwg-c-code">Code No.</th>
                  <th className="iwg-c-name">Institute Name</th>
                  <th className="iwg-c-month">Month</th>
                  <th className="iwg-c-type">Type</th>
                  <th className="iwg-c-total">Total</th>
                  <th className="iwg-c-amt">G.P.F.</th>
                  <th className="iwg-c-amt">G.P.F.Adv</th>
                  <th className="iwg-c-amt">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="iwg-empty" colSpan={9}>
                      No records found
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.srNo}-${row.code}`}>
                      <td className="iwg-c-sr">{row.srNo}</td>
                      <td className="iwg-c-code">{row.code}</td>
                      <td className="iwg-c-name">{row.instituteName}</td>
                      <td className="iwg-c-month">{row.month}</td>
                      <td className="iwg-c-type">{row.type}</td>
                      <td className="iwg-c-total">{row.total}</td>
                      <td className="iwg-c-amt">{amount(row.gpf)}</td>
                      <td className="iwg-c-amt">{amount(row.gpfAdvance)}</td>
                      <td className="iwg-c-amt">{amount(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td className="iwg-c-sr" colSpan={5}>
                      TOTAL
                    </td>
                    <td className="iwg-c-total">{report.total.total}</td>
                    <td className="iwg-c-amt">{amount(report.total.gpf)}</td>
                    <td className="iwg-c-amt">{amount(report.total.gpfAdvance)}</td>
                    <td className="iwg-c-amt">{amount(report.total.amount)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <div className="iwg-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar,Gujarat State</div>
          </div>
        </div>
      ) : null}

      {report && rows.length > 0 ? (
        <div className="iwg-actions no-print">
          <GridToolbar
            title="Institute Wise GPF Summary"
            columns={COLUMNS}
            rows={exportRows}
            showSearch={false}
            hiddenActions={["excel", "print"]}
          />
          <div className="iwg-actions-main">
            <button
              type="button"
              className="iwg-btn"
              onClick={handleExcel}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Excel"}
            </button>
            <button
              type="button"
              className="iwg-btn"
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
