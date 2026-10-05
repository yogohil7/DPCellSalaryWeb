import { useEffect, useMemo, useState } from "react";
import {
  getInstituteWiseSalary,
  getInstituteWiseSalaryMeta,
  downloadInstituteWiseSalaryExcel,
} from "../utils/instituteWiseSalaryApi";
import { listActiveSections } from "../utils/sectionApi";
import { sortInstitutesByCode } from "../utils/instituteCodeSort";
import { GridToolbar } from "../components/DataGrid";
import "./instituteWiseSalary.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

/*
  Money: stored values, en-IN with paise. An exact zero prints as "0"
  (the legacy report convention) instead of "0.00".
*/
function money(value) {
  const n = Number(value || 0);
  if (n === 0) return "0";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* Screen, CSV, PDF, Copy and Print all read these columns. */
const COLUMNS = [
  { key: "srNo", label: "SR.NO." },
  { key: "empName", label: "EMP NAME" },
  { key: "mode", label: "MODE" },
  { key: "designation", label: "DESIG." },
  { key: "basic", label: "BASIC" },
  { key: "gradePay", label: "G.P." },
  { key: "da", label: "DA" },
  { key: "hra", label: "HRA" },
  { key: "medi", label: "MEDI" },
  { key: "cla", label: "CLA" },
  { key: "ta", label: "TA" },
  { key: "speAll", label: "SPE.ALL" },
  { key: "gross", label: "GROSS" },
  { key: "gpf", label: "GPF" },
  { key: "gpfAdv", label: "GPF ADV." },
  { key: "nps", label: "NPS" },
  { key: "it", label: "IT" },
  { key: "pt", label: "PT" },
  { key: "othDed", label: "OTH. DEDU." },
  { key: "totalDed", label: "TOTAL DEDU." },
  { key: "net", label: "NET SAL." },
];

const MONEY_KEYS = [
  "basic", "gradePay", "da", "hra", "medi", "cla", "ta", "speAll",
  "gross", "gpf", "gpfAdv", "nps", "it", "pt", "othDed", "totalDed", "net",
];

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function thisYear() {
  return new Date().getFullYear();
}

function SalaryTable({ rows, total, totalLabel }) {
  return (
    <div className="iws-table-wrap">
      <table className="iws-table">
        <thead>
          <tr>
            <th>SR.NO.</th>
            <th>EMP NAME</th>
            <th>MODE</th>
            <th>DESIG.</th>
            <th>BASIC</th>
            <th>G.P.</th>
            <th>DA</th>
            <th>HRA</th>
            <th>MEDI</th>
            <th>CLA</th>
            <th>TA</th>
            <th>SPE.ALL</th>
            <th>GROSS</th>
            <th>GPF</th>
            <th>GPF ADV.</th>
            <th>NPS</th>
            <th>IT</th>
            <th>PT</th>
            <th>OTH. DEDU.</th>
            <th>TOTAL DEDU.</th>
            <th>NET SAL.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.detailId || row.daBillId || "r"}-${row.srNo}-${row.employeeId}`}>
              <td className="iws-c">{row.srNo}</td>
              <td className="iws-l">{row.empName}</td>
              <td className="iws-c">{row.mode}</td>
              <td className="iws-c">{row.designation}</td>
              <td className="iws-n">{money(row.basic)}</td>
              <td className="iws-n">{money(row.gradePay)}</td>
              <td className="iws-n">{money(row.da)}</td>
              <td className="iws-n">{money(row.hra)}</td>
              <td className="iws-n">{money(row.medi)}</td>
              <td className="iws-n">{money(row.cla)}</td>
              <td className="iws-n">{money(row.ta)}</td>
              <td className="iws-n">{money(row.speAll)}</td>
              <td className="iws-n iws-bold">{money(row.gross)}</td>
              <td className="iws-n">{money(row.gpf)}</td>
              <td className="iws-n">{money(row.gpfAdv)}</td>
              <td className="iws-n">{money(row.nps)}</td>
              <td className="iws-n">{money(row.it)}</td>
              <td className="iws-n">{money(row.pt)}</td>
              <td className="iws-n">{money(row.othDed)}</td>
              <td className="iws-n">{money(row.totalDed)}</td>
              <td className="iws-n iws-bold">{money(row.net)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="iws-c iws-bold" colSpan={4}>
              {totalLabel || "Total"}
            </td>
            <td className="iws-n">{money(total.basic)}</td>
            <td className="iws-n">{money(total.gradePay)}</td>
            <td className="iws-n">{money(total.da)}</td>
            <td className="iws-n">{money(total.hra)}</td>
            <td className="iws-n">{money(total.medi)}</td>
            <td className="iws-n">{money(total.cla)}</td>
            <td className="iws-n">{money(total.ta)}</td>
            <td className="iws-n">{money(total.speAll)}</td>
            <td className="iws-n">{money(total.gross)}</td>
            <td className="iws-n">{money(total.gpf)}</td>
            <td className="iws-n">{money(total.gpfAdv)}</td>
            <td className="iws-n">{money(total.nps)}</td>
            <td className="iws-n">{money(total.it)}</td>
            <td className="iws-n">{money(total.pt)}</td>
            <td className="iws-n">{money(total.othDed)}</td>
            <td className="iws-n">{money(total.totalDed)}</td>
            <td className="iws-n">{money(total.net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function InstituteWiseSalary({ user, onBack }) {
  /* A4 PORTRAIT for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("instituteWiseSalary");
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [allInstitutes, setAllInstitutes] = useState([]);
  const [metaYears, setMetaYears] = useState([]);

  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [fromMonth, setFromMonth] = useState("1");
  const [fromYear, setFromYear] = useState(String(thisYear()));
  const [toMonth, setToMonth] = useState(String(now.getMonth() + 1));
  const [toYear, setToYear] = useState(String(thisYear()));
  const [allMonths, setAllMonths] = useState(false);
  const [salaryType, setSalaryType] = useState("ALL");
  const [salaryTime, setSalaryTime] = useState("ALL");

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

  const years = useMemo(() => {
    if (metaYears.length) return metaYears;
    const y = thisYear();
    return [0, 1, 2, 3, 4, 5].map((n) => String(y - n));
  }, [metaYears]);

  useEffect(() => {
    let active = true;
    listActiveSections()
      .then((rows) => {
        if (!active) return;
        const list = (Array.isArray(rows) ? rows : [])
          .map((r) => ({ id: r.sectionId ?? r.id, name: r.sectionName || "" }))
          .filter((r) => r.id != null && r.name);
        setSections(list);
      })
      .catch(() => {
        if (active) setSections([]);
      });
    getInstituteWiseSalaryMeta()
      .then((res) => {
        if (!active) return;
        const data = res?.data || {};
        if (Array.isArray(data.institutes)) setAllInstitutes(data.institutes);
        const list = data.years || [];
        if (list.length) {
          setMetaYears(list);
          if (!list.includes(String(thisYear()))) {
            setFromYear(list[list.length - 1]);
            setToYear(list[0]);
          }
        }
      })
      .catch(() => {
        if (active) {
          setAllInstitutes([]);
          setMetaYears([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  /* The institute dropdown follows the selected section.
     Natural InstituteCode presentation order (never InstituteId). */
  const visibleInstitutes = useMemo(() => {
    const list = allInstitutes.filter((i) => i.instituteCode && i.instituteName);
    const filtered = !sectionId
      ? list
      : list.filter((i) => String(i.sectionId) === String(sectionId));
    return sortInstitutesByCode(filtered);
  }, [allInstitutes, sectionId]);

  useEffect(() => {
    if (!instituteCode || !sectionId) return;
    const stillThere = allInstitutes.some(
      (i) =>
        String(i.instituteCode).toUpperCase() === String(instituteCode).toUpperCase() &&
        String(i.sectionId) === String(sectionId)
    );
    if (!stillThere) setInstituteCode("");
  }, [sectionId, instituteCode, allInstitutes]);

  const filters = {
    sectionId: sectionId || undefined,
    instituteCode: instituteCode || undefined,
    fromMonth: allMonths ? undefined : fromMonth,
    fromYear: allMonths ? undefined : fromYear,
    toMonth: allMonths ? undefined : toMonth,
    toYear: allMonths ? undefined : toYear,
    allMonths: allMonths || undefined,
    salaryType,
    salaryTime,
  };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getInstituteWiseSalary(filters);
      const data = res?.data || null;
      setReport(data);
      if (!data || (data.rowCount || 0) === 0) {
        setMessage("No salary records found for the selected criteria.");
      } else if (data.truncated) {
        setMessage(
          `Showing first ${data.maxRows} of ${data.rowCount} records. Narrow the filters to see the rest.`
        );
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Institute Wise Salary Report.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadInstituteWiseSalaryExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  const institutes = report?.institutes || [];

  /* Flat export array: institute/month context travels in extra columns. */
  const exportRows = useMemo(() => {
    const out = [];
    const pushBlock = (rows, total, context) => {
      for (const row of rows) {
        const mapped = { ...row, ...context };
        MONEY_KEYS.forEach((k) => {
          mapped[k] = money(row[k]);
        });
        out.push(mapped);
      }
      if (rows.length > 0) {
        const totalRow = { srNo: "TOTAL", empName: "", mode: "", designation: "", ...context };
        MONEY_KEYS.forEach((k) => {
          totalRow[k] = money(total[k]);
        });
        out.push(totalRow);
      }
    };
    for (const inst of institutes) {
      const ctx = {
        instituteCode: inst.code,
        instituteName: inst.instituteName,
      };
      for (const month of inst.months) {
        pushBlock(month.rows, month.total, { ...ctx, salaryMonth: month.label });
      }
      for (const da of inst.daBills) {
        pushBlock(da.rows, da.total, {
          ...ctx,
          salaryMonth: `DA: ${da.period}${da.paidMonth ? ` (Paid ${da.paidMonth})` : ""}`,
        });
      }
    }
    return out;
  }, [institutes]);

  const exportColumns = useMemo(
    () => [
      { key: "instituteCode", label: "Institute Code" },
      { key: "instituteName", label: "Institute Name" },
      { key: "salaryMonth", label: "Salary Month" },
      ...COLUMNS,
    ],
    []
  );

  return (
    <div className="iws-page">
      <div className="iws-toolbar no-print">
        <button type="button" className="iws-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="iws-filters no-print" onSubmit={handleShow}>
        <div className="iws-field">
          <label htmlFor="iws-section">Section</label>
          <select
            id="iws-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">All Sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="iws-field iws-field-wide">
          <label htmlFor="iws-institute">Institute</label>
          <select
            id="iws-institute"
            value={instituteCode}
            onChange={(e) => setInstituteCode(e.target.value)}
          >
            <option value="">All Institutes</option>
            {visibleInstitutes.map((i) => (
              <option key={i.instituteCode} value={i.instituteCode}>
                {i.instituteCode} - {i.instituteName}
              </option>
            ))}
          </select>
        </div>

        <div className="iws-field">
          <label htmlFor="iws-from-month">From Month</label>
          <div className="iws-month-pair">
            <select
              id="iws-from-month"
              value={fromMonth}
              disabled={allMonths}
              onChange={(e) => setFromMonth(e.target.value)}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name.slice(0, 3)}
                </option>
              ))}
            </select>
            <select
              aria-label="From year"
              value={fromYear}
              disabled={allMonths}
              onChange={(e) => setFromYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="iws-field">
          <label htmlFor="iws-to-month">To Month</label>
          <div className="iws-month-pair">
            <select
              id="iws-to-month"
              value={toMonth}
              disabled={allMonths}
              onChange={(e) => setToMonth(e.target.value)}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name.slice(0, 3)}
                </option>
              ))}
            </select>
            <select
              aria-label="To year"
              value={toYear}
              disabled={allMonths}
              onChange={(e) => setToYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="iws-field iws-field-check">
          <label htmlFor="iws-all">Month Range</label>
          <label className="iws-check">
            <input
              id="iws-all"
              type="checkbox"
              checked={allMonths}
              onChange={(e) => setAllMonths(e.target.checked)}
            />
            ALL
          </label>
        </div>

        <div className="iws-field">
          <label htmlFor="iws-type">Salary Type</label>
          <select
            id="iws-type"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
          </select>
        </div>

        <div className="iws-field">
          <label htmlFor="iws-time">Salary Time</label>
          <select
            id="iws-time"
            value={salaryTime}
            onChange={(e) => setSalaryTime(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
          </select>
        </div>

        <button type="submit" className="iws-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="iws-message no-print">{message}</div> : null}

      {report && institutes.length > 0 ? (
        <div className="iws-sheet">
          <div className="iws-head">
            <div className="iws-head-line">{report.heading}</div>
            <div className="iws-head-line">{report.monthLine}</div>
            <div className="iws-head-line">{report.subHeading}</div>
            <div className="iws-head-sub">
              {report.sectionTitle} | Type: {report.salaryType}
            </div>
          </div>

          {institutes.map((inst) => (
            <section className="iws-inst-block" key={inst.code}>
              <div className="iws-inst-head">
                <div>
                  <span className="iws-inst-label">INSTITUTE CODE: </span>
                  <span className="iws-inst-value">{inst.code}</span>
                </div>
                <div>
                  <span className="iws-inst-label">INSTITUTE NAME: </span>
                  <span className="iws-inst-value">{inst.instituteName}</span>
                </div>
              </div>

              {inst.months.map((month) => (
                <div className="iws-month-block" key={month.key}>
                  <div className="iws-month-label">{month.label}</div>
                  <SalaryTable rows={month.rows} total={month.total} />
                </div>
              ))}

              {inst.daBills.map((da) => (
                <div className="iws-month-block" key={da.billCode}>
                  <div className="iws-month-label">
                    Da: {da.period}
                    {da.paidMonth ? ` (Paid: ${da.paidMonth})` : ""}
                  </div>
                  <SalaryTable rows={da.rows} total={da.total} />
                </div>
              ))}
            </section>
          ))}

          <div className="iws-grand">
            <div className="iws-month-label">GRAND TOTAL</div>
            <SalaryTable
              rows={[]}
              total={report.grandTotal}
              totalLabel="Grand Total"
            />
          </div>

          <div className="iws-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="iws-actions no-print">
            <GridToolbar
              reportName="instituteWiseSalary"
              subtitle={[report.heading, report.monthLine, report.subHeading, `${report.sectionTitle || ""} | Type: ${report.salaryType || ""}`]}
              title="Institute Wise Salary"
              columns={exportColumns}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="iws-actions-main">
              <button
                type="button"
                className="iws-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button
                type="button"
                className="iws-btn"
                onClick={() => printReport("instituteWiseSalary")}
              >
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
