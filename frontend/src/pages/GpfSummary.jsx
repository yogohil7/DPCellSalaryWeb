import { useEffect, useMemo, useState } from "react";
import { getGpfSummary, downloadGpfSummaryExcel } from "../utils/gpfSummaryApi";
import { getChequeRegisterMeta } from "../utils/chequeRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./gpfSummary.css";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* The six printed columns, in order. Exports read these too. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "name", label: "NAME" },
  { key: "emp", label: "EMP" },
  { key: "gpf", label: "G.P.F." },
  { key: "gpfAdvance", label: "G.P.F.Adv" },
  { key: "total", label: "TOTAL" },
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

export default function GpfSummary({ user, onBack }) {
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
      gpf: money(row.gpf),
      gpfAdvance: money(row.gpfAdvance),
      total: money(row.total),
    }));
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        srNo: "Total",
        name: "",
        emp: report.total.emp,
        gpf: money(report.total.gpf),
        gpfAdvance: money(report.total.gpfAdvance),
        total: money(report.total.total),
      },
    ];
  }, [rows, report]);

  const filters = { month, year, sectionId: sectionId || undefined };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getGpfSummary(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage("No approved GPF deductions found for the selected month.");
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the GPF Summary.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadGpfSummaryExcel(filters);
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
    <div className="gs-page">
      <div className="gs-toolbar no-print">
        <button type="button" className="gs-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="gs-filters no-print" onSubmit={handleShow}>
        <div className="gs-field">
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

        <div className="gs-field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="gs-field">
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

        <button type="submit" className="gs-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="gs-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="gs-sheet">
          <div className="gs-head">
            <div className="gs-head-line">{report.heading}</div>
            <div className="gs-head-line">{report.monthLine}</div>
            <div className="gs-head-line">{report.subHeading}</div>
          </div>

          {/*
             Cheque / Chalan fields sit above the table, as on the printed
             form. Typing here changes nothing in the salary tables.
          */}
          <div className="gs-cheque">
            <label className="gs-cheque-field">
              <span>Cheque No:-</span>
              <input
                type="text"
                className="gs-cheque-input no-print"
                value={chequeNo}
                maxLength={40}
                onChange={(e) => setChequeNo(e.target.value)}
              />
              <span className="gs-cheque-print">{chequeNo}</span>
            </label>

            <label className="gs-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="gs-cheque-input no-print"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
              />
              <span className="gs-cheque-print">{formatReportDate(chequeDate)}</span>
            </label>

            <label className="gs-cheque-field">
              <span>Chalan No:-</span>
              <input
                type="text"
                className="gs-cheque-input no-print"
                value={chalanNo}
                maxLength={40}
                onChange={(e) => setChalanNo(e.target.value)}
              />
              <span className="gs-cheque-print">{chalanNo}</span>
            </label>

            <label className="gs-cheque-field">
              <span>Date:-</span>
              <input
                type="date"
                className="gs-cheque-input no-print"
                value={chalanDate}
                onChange={(e) => setChalanDate(e.target.value)}
              />
              <span className="gs-cheque-print">{formatReportDate(chalanDate)}</span>
            </label>
          </div>

          <div className="gs-table-wrap">
            <table className="gs-table">
              <thead>
                <tr>
                  <th className="gs-c-sr">Sr. No.</th>
                  <th className="gs-c-name">NAME</th>
                  <th className="gs-c-emp">EMP</th>
                  <th className="gs-c-amt">G.P.F.</th>
                  <th className="gs-c-amt">G.P.F.Adv</th>
                  <th className="gs-c-amt">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.srNo}-${row.name}`}>
                    <td className="gs-c-sr">{row.srNo}</td>
                    <td className="gs-c-name">{row.name}</td>
                    <td className="gs-c-emp">{row.emp}</td>
                    <td className="gs-c-amt">{money(row.gpf)}</td>
                    <td className="gs-c-amt">{money(row.gpfAdvance)}</td>
                    <td className="gs-c-amt">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="gs-c-sr">Total</td>
                  <td className="gs-c-name" />
                  <td className="gs-c-emp">{report.total.emp}</td>
                  <td className="gs-c-amt">{money(report.total.gpf)}</td>
                  <td className="gs-c-amt">{money(report.total.gpfAdvance)}</td>
                  <td className="gs-c-amt">{money(report.total.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="gs-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="gs-actions no-print">
            <GridToolbar
              title="GPF Summary"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="gs-actions-main">
              <button
                type="button"
                className="gs-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button type="button" className="gs-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
