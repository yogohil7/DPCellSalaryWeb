import { useEffect, useMemo, useState } from "react";
import { getBankCopy, downloadBankCopyExcel } from "../utils/bankCopyApi";
import { getChequeRegisterMeta } from "../utils/chequeRegisterApi";
import { GridToolbar } from "../components/DataGrid";
import "./bankCopy.css";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* The five printed columns, in order — exact labels as per the bank copy spec. */
const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "code", label: "CODE" },
  { key: "name", label: "EMPLOYEE NAME" },
  { key: "bankAccount", label: "BANK ACCOUNT NUMBER" },
  { key: "amount", label: "AMOUNT" },
];

/* The two separate payment files. Regular is the default. */
const PAYMENT_TYPES = [
  { value: "REGULAR", label: "Regular Salary Bank Copy" },
  { value: "DA_DIFFERENCE", label: "DA Difference Bank Copy" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function BankCopy({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [years, setYears] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [paymentType, setPaymentType] = useState("REGULAR");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

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
     server's final order with its Sr. No., plus the same TOTAL line the table
     foot prints. Nothing is re-sorted or re-numbered here.
  */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => ({
      ...row,
      amount: money(row.amount),
    }));
    if (!report || mapped.length === 0) return mapped;
    return [
      ...mapped,
      {
        /* TOTAL sits under EMPLOYEE NAME, as on the printed form. */
        srNo: "",
        code: "",
        name: "TOTAL",
        bankAccount: "",
        amount: money(report.total),
      },
    ];
  }, [rows, report]);

  const filters = {
    month,
    year,
    sectionId: sectionId || undefined,
    paymentType,
  };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getBankCopy(filters);
      setReport(res?.data || null);
      if (!res?.data?.rows?.length) {
        setMessage(
          paymentType === "DA_DIFFERENCE"
            ? "No approved DA Difference bills found for the selected month."
            : "No approved salary bills found for the selected month."
        );
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Bank Copy.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadBankCopyExcel(filters);
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
    <div className="bc-page">
      <div className="bc-toolbar no-print">
        <button type="button" className="bc-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="bc-filters no-print" onSubmit={handleShow}>
        <div className="bc-field">
          <label>Payment Type</label>
          <select
            value={paymentType}
            onChange={(e) => {
              setPaymentType(e.target.value);
              /* The two files are separate; clear the previous one rather
                 than leaving it on screen under the new heading. */
              setReport(null);
              setMessage("");
            }}
          >
            {PAYMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="bc-field">
          <label>Section</label>
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">All Sections</option>
            {sections.map((section) => (
              <option key={section.sectionId} value={section.sectionId}>
                {section.sectionName}
              </option>
            ))}
          </select>
        </div>

        <div className="bc-field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="bc-field">
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
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          )}
        </div>

        <button type="submit" className="bc-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="bc-message no-print">{message}</div> : null}

      {report && rows.length > 0 ? (
        <div className="bc-sheet">
          <div className="bc-head">
            {report.heading.map((line) => (
              <div key={line} className="bc-head-line">
                {line}
              </div>
            ))}
            <div className="bc-head-line">{report.monthLine}</div>
            <div className="bc-head-line">{report.schemeLine}</div>
          </div>

          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  <th className="bc-c-sr">Sr. No.</th>
                  <th className="bc-c-code">CODE</th>
                  <th className="bc-c-name">EMPLOYEE NAME</th>
                  <th className="bc-c-bank">BANK A/c</th>
                  <th className="bc-c-amt">AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.type}-${row.code}-${row.srNo}`}
                    className={row.type === "INSTITUTE" ? "bc-institute" : ""}
                  >
                    <td className="bc-c-sr">{row.srNo}</td>
                    <td className="bc-c-code">{row.code}</td>
                    <td className="bc-c-name">{row.name}</td>
                    <td className="bc-c-bank">{row.bankAccount}</td>
                    <td className="bc-c-amt">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="bc-c-sr" />
                  <td className="bc-c-code" />
                  <td className="bc-c-name">TOTAL</td>
                  <td className="bc-c-bank" />
                  <td className="bc-c-amt">{money(report.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="bc-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="bc-actions no-print">
            <GridToolbar
              title={
                report.paymentType === "DA_DIFFERENCE"
                  ? "DA Difference Bank Copy"
                  : "Bank Copy"
              }
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="bc-actions-main">
              <button
                type="button"
                className="bc-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button type="button" className="bc-btn" onClick={handlePrint}>
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
