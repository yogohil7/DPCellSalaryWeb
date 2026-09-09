import React, { useEffect, useMemo, useState } from "react";
import { GridToolbar } from "../components/DataGrid";
import {
  getSalaryBillCode,
  guardSalaryBillCode,
  saveBillEmployeeOrder,
} from "../utils/salaryBillCodeApi";
import {
  listOpenSalaryEntryBillCodes,
  getSalaryEntryEmployees,
  recalculateTransportAllowance,
  saveSalaryEntryDraft,
  submitSalaryEntry,
} from "../utils/salaryEntryApi";
import SalaryEntryVariationReport from "./SalaryEntryVariationReport";
import { listInstitutes } from "../utils/instituteApi";
import { listActiveSections } from "../utils/sectionApi";
import { calculateSalaryAmounts, calculateNps, calculateChequeAmount } from "../utils/salaryBasicCalc";
import "./salaryEntry.css";

/* Bill Month remains available for existing UX; Salary Month comes from Bill Code. */
const BILL_MONTH_OPTIONS = [
  "JAN-26",
  "FEB-26",
  "MAR-26",
  "APR-26",
  "MAY-26",
  "JUN-26",
  "JUL-26",
  "AUG-26",
  "SEP-26",
  "OCT-26",
  "NOV-26",
  "DEC-26",
  "JAN-27",
  "FEB-27",
  "MAR-27",
  "APR-27",
  "MAY-27",
  "JUN-27",
  "JUL-27",
  "AUG-27",
  "SEP-27",
  "OCT-27",
  "NOV-27",
  "DEC-27",
];

/** Convert Salary Month label (OCT-2026 / OCT-26) → Bill Month option (OCT-26). */
const salaryMonthToBillMonth = (salaryMonthLabel) => {
  const raw = String(salaryMonthLabel || "").trim().toUpperCase();
  if (!raw) return "";
  const match = raw.match(/^([A-Z]{3})-?(?:20)?(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}`;
  const parts = raw.split("-");
  if (parts.length >= 2) {
    const mon = parts[0].slice(0, 3);
    const yr = String(parts[1]).replace(/^20/, "").slice(-2);
    if (mon && yr) return `${mon}-${yr}`;
  }
  return "";
};

const normalizePension = (employee) => {
  const raw = String(
    employee?.pension || employee?.gpfNps || employee?.GPFNPS || ""
  )
    .trim()
    .toUpperCase();
  if (raw === "GPF" || raw === "NPS") return raw;
  return "";
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const sameEmployeeId = (a, b) => Number(a) === Number(b);

const money = (value) => {
  return toNumber(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/* =========================================================
   TOTAL DEDUCTION
   GPF Subscription
   + NPS
   + Income Tax
   + Professional Tax
   + Other Deduction
   (ADV / NPS Adv removed from Salary Entry)
   ========================================================= */

const calculateTotalDeduction = (employee) => {
  return (
    toNumber(employee.gpfSubscription) +
    toNumber(employee.gpfAdvance ?? employee.gpfAdv) +
    toNumber(employee.nps) +
    toNumber(employee.incomeTax) +
    toNumber(employee.professionTax ?? employee.professionalTax) +
    toNumber(employee.otherDeduction)
  );
};

/* =========================================================
   EMPLOYEE CALCULATION
   Total Basic Pay = Basic + FIX Basic (base only; not double-counted in Gross)
   DA / HRA recompute from rates when Basic drives them (unless manual override).
   Manual NPS is preserved when npsManual is set.
   ========================================================= */

const resolveFixBasic = (employee) =>
  toNumber(employee.fixBasic ?? employee.gradePay);

const resolvePercentRate = (storedRate, amount, base) => {
  const rate = Number(storedRate);
  if (Number.isFinite(rate) && rate >= 0) return rate;
  const b = toNumber(base);
  if (b > 0) {
    const inferred = (toNumber(amount) / b) * 100;
    if (Number.isFinite(inferred) && inferred >= 0) return inferred;
  }
  return null;
};

const calculateEmployee = (employee) => {
  const basicPay =
    String(employee.employeeType || "").toUpperCase() === "FIX"
      ? 0
      : toNumber(employee.basicPay);
  const fixBasic = resolveFixBasic(employee);
  const totalBasic = basicPay + fixBasic;
  const pension = normalizePension(employee);
  const npsManual = Boolean(employee.npsManual);
  const daManual = Boolean(employee.daManual);
  const hraManual = Boolean(employee.hraManual);
  const forceEarningsFromBasic =
    employee.basicDriven === true || employee.recalcFromBasic === true;

  const prevTotalBasic =
    toNumber(employee.totalBasic ?? employee.totalBasicPay) || totalBasic;
  const daRate = resolvePercentRate(
    employee.daRate ?? employee.daPercentage,
    employee.da,
    prevTotalBasic
  );
  const hraRate = resolvePercentRate(
    employee.hraRate ?? employee.hraPercentage,
    employee.hra,
    prevTotalBasic
  );

  const derived = calculateSalaryAmounts({
    basic: basicPay,
    fixBasic,
    daPercentage: daRate != null ? daRate : 0,
    hraPercentage: hraRate != null ? hraRate : 0,
    payrollHra: Boolean(employee.hraForcedZero),
  });

  let da = toNumber(employee.da);
  if (forceEarningsFromBasic || !daManual) {
    da = daRate != null ? derived.da : da;
  }

  let hra = toNumber(employee.hra);
  if (employee.hraForcedZero) {
    hra = 0;
  } else if (forceEarningsFromBasic || !hraManual) {
    hra = hraRate != null ? derived.hra : hra;
  }

  let nps = toNumber(employee.nps);
  if (pension === "NPS") {
    if (!npsManual) {
      nps = calculateNps(totalBasic, da);
    }
  } else if (pension === "GPF") {
    nps = 0;
  }

  const professionTax = toNumber(
    employee.professionTax ?? employee.professionalTax
  );
  const incomeTax = toNumber(employee.incomeTax);
  const otherDeduction = toNumber(employee.otherDeduction);

  const grossAmount =
    totalBasic +
    da +
    hra +
    toNumber(employee.ma) +
    toNumber(employee.ta) +
    toNumber(employee.cla) +
    toNumber(employee.specialAllowance) +
    toNumber(employee.washingAllowance) +
    toNumber(employee.otherEarnings) +
    toNumber(employee.nppa);

  const next = {
    ...employee,
    basicPay,
    fixBasic,
    gradePay: fixBasic,
    totalBasic,
    totalBasicPay: totalBasic,
    da,
    hra,
    daRate: daRate != null ? daRate : employee.daRate ?? null,
    hraRate: hraRate != null ? hraRate : employee.hraRate ?? null,
    nps,
    npsManual: pension === "NPS" ? npsManual : false,
    daManual: forceEarningsFromBasic ? false : daManual,
    hraManual: forceEarningsFromBasic ? false : hraManual,
    taManual: forceEarningsFromBasic ? false : Boolean(employee.taManual),
    professionTax,
    professionalTax: professionTax,
    incomeTax,
    otherDeduction,
    /* GPF Advance is an entered deduction; it is kept, not zeroed. */
    gpfAdv: toNumber(employee.gpfAdvance ?? employee.gpfAdv),
    gpfAdvance: toNumber(employee.gpfAdvance ?? employee.gpfAdv),
  };
  if (pension === "NPS") {
    /* An NPS member has no GPF at all — neither subscription nor advance. */
    next.gpfSubscription = 0;
    next.gpfAdv = 0;
    next.gpfAdvance = 0;
  }

  const totalDeduction = calculateTotalDeduction(next);
  const netSalary = grossAmount - totalDeduction;
  const chequeAmount = calculateChequeAmount({
    netSalary,
    incomeTax,
    professionalTax: professionTax,
  });

  return {
    ...next,
    grossAmount,
    grossSalary: grossAmount,
    totalDeduction,
    netSalary,
    chequeAmount,
  };
};

export default function SalaryEntry({
  user,
  onBack,
  onOpenVariation,
  initialBillCode = "",
  initialBillMonth = "",
  initialSalaryMonth = "",
  initialInstituteCode = "",
  returnedMode = false,
}) {
  const [employees, setEmployees] =
    useState([]);
  const [showVariationReport, setShowVariationReport] = useState(false);

  const [billMonth, setBillMonth] =
    useState(initialBillMonth || "");

  const [salaryMonth, setSalaryMonth] =
    useState(initialSalaryMonth || "");

  const [billCode, setBillCode] =
    useState(initialBillCode || "");

  const [billCodeRecords, setBillCodeRecords] =
    useState([]);

  const [billCodesLoading, setBillCodesLoading] =
    useState(true);

  const [billCodesError, setBillCodesError] =
    useState("");

  const [selectedBillCodeMeta, setSelectedBillCodeMeta] =
    useState(null);

  const [instituteCode, setInstituteCode] =
    useState(initialInstituteCode || "");

  const [institutes, setInstitutes] = useState([]);
  /* Institute Section (Section Master) → filters the Institute Code list. */
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");

  const [institutesLoading, setInstitutesLoading] =
    useState(true);
  const [institutesError, setInstitutesError] =
    useState("");

  const [billType, setBillType] =
    useState("Regular");

  const [billNo, setBillNo] =
    useState("");

  const [billDate, setBillDate] =
    useState("");

  const [npsScheduleNo, setNpsScheduleNo] =
    useState("");

  const [remarks, setRemarks] =
    useState("");

  const [status, setStatus] =
    useState("DRAFT");

  const [draggedEmployeeId, setDraggedEmployeeId] =
    useState(null);

  const [dragOverEmployeeId, setDragOverEmployeeId] =
    useState(null);
  const [salarySearch, setSalarySearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [getDataMessage, setGetDataMessage] = useState("");
  /* Employees whose Basic was raised by an increment in this salary month. */
  const [incrementNotices, setIncrementNotices] = useState([]);

  const billCodeStatus = String(
    selectedBillCodeMeta?.status || selectedBillCodeMeta?.masterStatus || ""
  ).toUpperCase();
  const instituteEntryStatus = String(status || "").toUpperCase();
  const isBillCodeLocked =
    billCodeStatus === "LOCKED" || billCodeStatus === "APPROVED";
  const isBillCodeCompleted = billCodeStatus === "COMPLETED";
  const isBillSubmitted = ["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(
    instituteEntryStatus
  );
  const isReturnedBill =
    returnedMode || instituteEntryStatus === "RETURNED";
  /* Exact Bill Code for API calls (never the stripped salary-month display code). */
  const activeBillCode = String(
    selectedBillCodeMeta?.resolvedBillCode ||
      initialBillCode ||
      billCode ||
      ""
  ).trim();
  /* Returned bills are editable for auditor correction; submitted/locked are read-only. */
  const salaryReadOnly =
    isBillCodeLocked ||
    isBillCodeCompleted ||
    instituteEntryStatus === "LOCKED" ||
    instituteEntryStatus === "APPROVED" ||
    (isBillSubmitted && !isReturnedBill);

  const readOnlyReasonMessage = () => {
    if (isBillCodeLocked) {
      return `Bill Code ${billCode} is locked/approved and cannot be modified.`;
    }
    if (isBillCodeCompleted) {
      return `Bill Code ${billCode} is completed and cannot be modified.`;
    }
    if (isBillSubmitted && !isReturnedBill) {
      return `Institute ${instituteCode || ""} salary bill for ${billCode} is ${instituteEntryStatus} and cannot be modified until returned.`;
    }
    return `Bill Code ${billCode} cannot be modified.`;
  };

  const applyBillCodeMeta = (record, { preserveBillMonth = false } = {}) => {
    if (!record) {
      setSelectedBillCodeMeta(null);
      return;
    }

    const rawCode = String(record.billCode || "").trim();
    const forcedInitial = String(initialBillCode || "").trim();
    const keepExactReturnedBill =
      Boolean(returnedMode) ||
      /-BM-[A-Z]{3}$/i.test(forcedInitial) ||
      Boolean(String(initialBillMonth || "").trim());

    /*
      Returning Bills / Bill-Month variants must keep the exact Bill Code
      (e.g. JUN-2026-BM-MAY). Normal Salary Entry still uses the salary-month
      master code in the dropdown and resolves BM variants via Bill Month.
    */
    const displayCode = keepExactReturnedBill
      ? forcedInitial || rawCode
      : rawCode.replace(/-BM-[A-Z]{3}$/i, "") || rawCode;

    setSelectedBillCodeMeta({
      ...record,
      billCode: displayCode,
      sourceBillCode:
        record.sourceBillCode ||
        displayCode.replace(/-BM-[A-Z]{3}$/i, "") ||
        displayCode,
      resolvedBillCode: rawCode || displayCode,
      billMonth: record.billMonth || initialBillMonth || "",
      salaryMonth: record.salaryMonth || initialSalaryMonth || "",
    });
    setBillCode(displayCode);

    const salaryMonthLabel =
      String(initialSalaryMonth || "").trim() ||
      (record.salaryMonth && record.salaryYear
        ? `${String(record.salaryMonth).split("-")[0].toUpperCase()}-${record.salaryYear}`
        : record.salaryMonth) ||
      displayCode.replace(/-BM-[A-Z]{3}$/i, "") ||
      displayCode ||
      "";

    setSalaryMonth(salaryMonthLabel);

    const explicitBillMonth =
      String(initialBillMonth || "").trim() ||
      String(record.billMonth || "").trim();
    const defaultBillMonth =
      explicitBillMonth || salaryMonthToBillMonth(salaryMonthLabel);

    if (defaultBillMonth) {
      if (preserveBillMonth || keepExactReturnedBill) {
        setBillMonth((current) =>
          keepExactReturnedBill
            ? explicitBillMonth || current || defaultBillMonth
            : current || defaultBillMonth
        );
      } else {
        setBillMonth(defaultBillMonth);
      }
    }
    if (record.billType) {
      setBillType(record.billType);
    }
  };

  const billMonthOptions = useMemo(() => {
    const opts = [...BILL_MONTH_OPTIONS];
    if (billMonth && !opts.includes(billMonth)) {
      opts.unshift(billMonth);
    }
    return opts;
  }, [billMonth]);

  /*
     Salary Entry dropdown shows ONLY bill codes whose SQL Server Status is OPEN.
     DRAFT / SUBMITTED / RESUBMITTED / VERIFIED / APPROVED / RETURNED / REJECTED /
     LOCKED / COMPLETED are never selectable here. The single exception is a bill
     opened explicitly from the Returning Bills screen (initialBillCode), which
     the backend also allows for the correct-and-resubmit flow.
  */
  const selectableBillCodeRecords = useMemo(() => {
    const seen = new Set();
    const openOnly = billCodeRecords.filter((row) => {
      const rowStatus = String(row.status || "").trim().toUpperCase();
      if (rowStatus !== "OPEN") return false;
      const code = String(row.billCode || "").trim().toUpperCase();
      /* Hide auto-created Bill-Month variants from normal picker. */
      if (!code || /-BM-[A-Z]{3}$/i.test(code)) return false;
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });

    if (initialBillCode) {
      const forced = String(initialBillCode).trim().toUpperCase();
      if (forced && !seen.has(forced)) {
        const record =
          billCodeRecords.find(
            (row) =>
              String(row.billCode || "").trim().toUpperCase() === forced
          ) || {
            billCode: forced,
            status: returnedMode ? "RETURNED" : "OPEN",
            billMonth: initialBillMonth || "",
            salaryMonth: initialSalaryMonth || "",
          };
        /* Keep exact returned Bill Code (including *-BM-MAY). */
        openOnly.unshift({
          ...record,
          billCode: forced,
          billMonth: record.billMonth || initialBillMonth || "",
          salaryMonth: record.salaryMonth || initialSalaryMonth || "",
        });
        seen.add(forced);
      }
    }

    return openOnly;
  }, [
    billCodeRecords,
    initialBillCode,
    initialBillMonth,
    initialSalaryMonth,
    returnedMode,
  ]);

  useEffect(() => {
    let active = true;

    setInstitutesLoading(true);
    setInstitutesError("");
    listInstitutes()
      .then((rows) => {
        if (!active) return;
        /* sectionId/sectionName already come from Institute Master — the real
           dbo.Institutes.SectionId relationship, not a code-prefix guess. */
        const mapped = (Array.isArray(rows) ? rows : []).map((row) => ({
          id: row.instituteId ?? row.id,
          code: row.instituteCode || row.code || "",
          name: row.instituteName || row.name || "",
          sectionId: row.sectionId != null ? Number(row.sectionId) : null,
          sectionName: row.sectionName || row.instituteType || "",
        })).filter((row) => row.code);
        setInstitutes(mapped);
        if (mapped.length === 0) {
          setInstitutesError("No institutes found in Institute Master.");
          setInstituteCode("");
          return;
        }
        setInstituteCode((current) => {
          if (
            initialInstituteCode &&
            mapped.some((row) => row.code === initialInstituteCode)
          ) {
            return initialInstituteCode;
          }
          return mapped.some((row) => row.code === current)
            ? current
            : mapped[0].code;
        });
      })
      .catch(() => {
        if (!active) return;
        setInstitutes([]);
        setInstituteCode("");
        setInstitutesError("Unable to load institutes. Please check the server connection.");
      })
      .finally(() => {
        if (active) setInstitutesLoading(false);
      });

    /* Section Master — the same source Cheque Register uses. */
    listActiveSections()
      .then((rows) => {
        if (!active) return;
        setSections(
          (Array.isArray(rows) ? rows : [])
            .map((row) => ({
              id: row.sectionId ?? row.id,
              name: row.sectionName || "",
            }))
            .filter((row) => row.id != null && row.name)
        );
      })
      .catch(() => {
        if (active) setSections([]);
      });

    return () => {
      active = false;
    };
  }, []);

  /*
     Keep Institute Section in step with the selected institute.

     The institute is the source of truth (it carries the real SectionId), so
     selecting or restoring an institute — including a returned bill opened
     from Returning Bills — sets its section automatically. This runs after
     institutes load, so there is no race where the code is set before the
     section is known.
  */
  useEffect(() => {
    if (!instituteCode || institutes.length === 0) return;
    const selected = institutes.find((row) => row.code === instituteCode);
    if (selected && selected.sectionId != null) {
      setSectionId((current) =>
        String(current) === String(selected.sectionId)
          ? current
          : String(selected.sectionId)
      );
    }
  }, [instituteCode, institutes]);

  /* Institutes belonging to the chosen section (all when none chosen). */
  const visibleInstitutes = useMemo(() => {
    if (!sectionId) return institutes;
    return institutes.filter(
      (row) => String(row.sectionId ?? "") === String(sectionId)
    );
  }, [institutes, sectionId]);

  /*
     Changing the section must not leave an institute from the previous
     section selected. A returned bill is never re-pointed this way.
  */
  const handleSectionChange = (nextSectionId) => {
    setSectionId(nextSectionId);
    if (returnedMode) return;

    const allowed = nextSectionId
      ? institutes.filter(
          (row) => String(row.sectionId ?? "") === String(nextSectionId)
        )
      : institutes;

    if (!allowed.some((row) => row.code === instituteCode)) {
      setInstituteCode(allowed.length ? allowed[0].code : "");
      setEmployees([]);
      setGetDataMessage("");
    }
  };

  /*
     Loads the Bill Code dropdown straight from SQL Server through the backend.
     The API returns ONLY Status = 'OPEN'; nothing is cached in localStorage.
     Called on page open and after every Save / Submit / Return / Resubmit / Lock
     so the list can never hold a stale bill code.
  */
  const loadBillCodes = async ({
    preferredCode = "",
    isActive = () => true,
  } = {}) => {
    setBillCodesLoading(true);
    setBillCodesError("");

    try {
      const rows = await listOpenSalaryEntryBillCodes();
      let list = Array.isArray(rows) ? rows : [];

      /* Returning Bills / exact Bill Code must be loaded even if not OPEN in the picker. */
      if (initialBillCode) {
        const already = list.some(
          (row) =>
            String(row.billCode || "").trim().toUpperCase() ===
            String(initialBillCode).trim().toUpperCase()
        );
        if (!already) {
          try {
            const record = await getSalaryBillCode(initialBillCode);
            if (record?.billCode) {
              list = [record, ...list];
            }
          } catch {
            /* keep the OPEN list as-is */
          }
        } else {
          /* Prefer the exact returned bill at the front for applyBillCodeMeta. */
          list = [
            ...list.filter(
              (row) =>
                String(row.billCode || "").trim().toUpperCase() ===
                String(initialBillCode).trim().toUpperCase()
            ),
            ...list.filter(
              (row) =>
                String(row.billCode || "").trim().toUpperCase() !==
                String(initialBillCode).trim().toUpperCase()
            ),
          ];
        }
      }

      if (!isActive()) return list;

      setBillCodeRecords(list);

      if (list.length === 0) {
        setBillCode("");
        setSelectedBillCodeMeta(null);
        setSalaryMonth("");
        setBillCodesError(
          "No OPEN Salary Bill Codes found. Create one in Salary Bill Code Master."
        );
        return list;
      }

      const preferred =
        (initialBillCode &&
          list.find(
            (row) =>
              String(row.billCode || "").trim().toUpperCase() ===
              String(initialBillCode).trim().toUpperCase()
          )) ||
        (preferredCode &&
          list.find((row) => row.billCode === preferredCode)) ||
        list.find(
          (row) =>
            String(row.billCode || "")
              .trim()
              .toUpperCase() ===
            String(preferredCode || "")
              .trim()
              .toUpperCase()
              .replace(/-BM-[A-Z]{3}$/i, "")
        ) ||
        list[0];
      applyBillCodeMeta(preferred, {
        preserveBillMonth:
          Boolean(preferredCode) ||
          Boolean(returnedMode) ||
          Boolean(initialBillMonth),
      });
      return list;
    } catch {
      if (!isActive()) return [];
      setBillCodeRecords([]);
      setBillCode("");
      setSelectedBillCodeMeta(null);
      setSalaryMonth("");
      setBillCodesError(
        "Salary Bill Code service is unavailable. Unable to load Salary Bill Codes. Please check the server connection."
      );
      return [];
    } finally {
      if (isActive()) setBillCodesLoading(false);
    }
  };

  /* Refresh after any workflow action; keep exact Bill Code + Bill Month. */
  const refreshBillCodesAfterAction = () => {
    loadBillCodes({ preferredCode: billCode }).catch(() => {});
  };

  useEffect(() => {
    let active = true;
    loadBillCodes({ isActive: () => active });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillCode]);

  useEffect(() => {
    if (!returnedMode && !initialBillCode) return;
    if (billCodesLoading || institutesLoading) return;
    if (!billCode || !instituteCode || !selectedBillCodeMeta) return;
    if (employees.length > 0) return;
    handleGetData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    returnedMode,
    initialBillCode,
    billCodesLoading,
    institutesLoading,
    billCode,
    instituteCode,
    selectedBillCodeMeta,
  ]);

  const handleBillCodeChange = (nextCode) => {
    const record = selectableBillCodeRecords.find(
      (row) => row.billCode === nextCode
    );
    applyBillCodeMeta(record || { billCode: nextCode });
    setEmployees([]);
    setGetDataMessage("");
    setIncrementNotices([]);
  };

  const withDisplayOrder = (rows) =>
    rows.map((row, index) => ({
      ...row,
      displayOrder: index + 1,
    }));

  const handleGetData = async () => {
    setGetDataMessage("");

    if (billCodesLoading) {
      setGetDataMessage("Loading Bill Codes...");
      return;
    }

    if (billCodesError || billCodeRecords.length === 0) {
      setGetDataMessage(
        billCodesError ||
          "Unable to load Salary Bill Codes. Please check the server connection."
      );
      return;
    }

    if (!billCode) {
      setGetDataMessage("Please select Bill Code.");
      return;
    }

    if (!instituteCode) {
      setGetDataMessage(
        institutesError || "Please select Institute."
      );
      return;
    }

    if (!selectedBillCodeMeta) {
      setGetDataMessage(
        `Bill Code ${billCode} was not found in Salary Bill Code Master.`
      );
      return;
    }

    if (!billMonth) {
      setGetDataMessage(
        "Please select Bill Month (defaults from Salary Month)."
      );
      return;
    }

    try {
      setGetDataMessage("Loading employees and calculating salary...");
      const result = await getSalaryEntryEmployees({
        billCode: activeBillCode || billCode,
        instituteCode,
        sectionId: sectionId || null,
        billMonth: billMonth || initialBillMonth,
        salaryMonth: salaryMonth || initialSalaryMonth,
      });
      const rows = Array.isArray(result?.data) ? result.data : [];
      const calcErrors = Array.isArray(result?.errors) ? result.errors : [];
      const calcWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
      const ordered = withDisplayOrder(
        [...rows].sort(
          (a, b) =>
            toNumber(a.displayOrder) - toNumber(b.displayOrder) ||
            toNumber(a.employeeId) - toNumber(b.employeeId)
        )
      );

      setEmployees(ordered);

      if (result?.bill?.billMonth) {
        setBillMonth(String(result.bill.billMonth));
      }
      if (result?.bill?.salaryMonth) {
        setSalaryMonth(String(result.bill.salaryMonth));
      }
      if (result?.bill?.billCode) {
        const exactCode = String(result.bill.billCode).trim();
        const keepExact =
          Boolean(returnedMode) ||
          Boolean(String(initialBillCode || "").trim()) ||
          Boolean(String(initialBillMonth || "").trim());
        if (keepExact) {
          setBillCode(exactCode);
          setSelectedBillCodeMeta((prev) => ({
            ...(prev || {}),
            billCode: exactCode,
            resolvedBillCode: exactCode,
            sourceBillCode:
              result.bill.sourceBillCode ||
              exactCode.replace(/-BM-[A-Z]{3}$/i, "") ||
              exactCode,
            billMonth: result.bill.billMonth || prev?.billMonth || "",
            salaryMonth: result.bill.salaryMonth || prev?.salaryMonth || "",
            /* Master status of the resolved bill row — not the LOCKED institute on another BM. */
            status: result.bill.resolvedMasterStatus || result.bill.masterStatus || prev?.status,
            masterStatus: result.bill.masterStatus || prev?.masterStatus,
          }));
        } else {
          setSelectedBillCodeMeta((prev) => ({
            ...(prev || {}),
            resolvedBillCode: exactCode,
            sourceBillCode:
              result.bill.sourceBillCode ||
              prev?.sourceBillCode ||
              billCode,
            billMonth: result.bill.billMonth || prev?.billMonth || "",
            salaryMonth: result.bill.salaryMonth || prev?.salaryMonth || "",
          }));
        }
      }
      if (result?.bill?.billNo != null) {
        setBillNo(String(result.bill.billNo || ""));
      }
      if (result?.bill?.billDate) {
        const raw = String(result.bill.billDate);
        setBillDate(raw.slice(0, 10));
      }
      /*
         Restore the saved NPS Schedule No. for THIS exact bill + institute.
         Checked against null rather than truthiness so a deliberately
         cleared value stays cleared instead of keeping a stale one.
      */
      if (result?.bill?.npsScheduleNo != null) {
        setNpsScheduleNo(String(result.bill.npsScheduleNo || ""));
      }
      if (result?.bill?.status) {
        setStatus(String(result.bill.status).toUpperCase());
      } else {
        setStatus("DRAFT");
      }

      /* The backend flags every row whose Basic came from an increment, so
         the user can see WHY it differs from Employee Master. */
      setIncrementNotices(
        ordered
          .filter((row) => row.incrementApplied && row.incrementMessage)
          .map((row) => ({
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            message: row.incrementMessage,
            appliedNow: Boolean(row.incrementDueNow),
          }))
      );

      /*
         No success line. A completed load is evident from the table itself,
         so nothing is reported when everything went well; the message area
         is reserved for things the user has to act on. Calculation errors,
         warnings and the read-only notices below are still reported, and an
         empty list leaves getDataMessage as "", which the render already
         treats as "show nothing" rather than an empty box.
      */
      const parts = [];
      if (calcErrors.length) {
        parts.push(
          `${calcErrors.length} calculation error(s): ${calcErrors
            .slice(0, 3)
            .map((e) => e.message)
            .join(" | ")}`
        );
      }
      if (calcWarnings.length) {
        parts.push(
          `${calcWarnings.length} warning(s): ${calcWarnings
            .slice(0, 3)
            .join(" | ")}`
        );
      }
      if (isBillCodeLocked) {
        parts.push("Bill is locked (read-only).");
      } else if (isBillCodeCompleted) {
        parts.push("Bill is completed (read-only).");
      }
      setGetDataMessage(parts.join(". "));
    } catch (error) {
      setEmployees([]);
      setIncrementNotices([]);
      setGetDataMessage(
        error.message || "Unable to load employee salary data."
      );
    }
  };

  /* =========================================================
     CALCULATED EMPLOYEES
     ========================================================= */

  const calculatedEmployees = useMemo(() => {
    return employees.map(calculateEmployee);
  }, [employees]);

  /*
     Does this bill deduct NPS from anyone?

     Every row is checked, not just the first. Number() maps null and "" to 0
     and undefined to NaN, and neither 0 nor NaN is > 0, so a blank, missing
     or "0" NPS correctly counts as no deduction. The value itself is never
     modified here — this only reads what calculateEmployee already produced.
  */
  const billHasNpsDeduction = () =>
    employees.some((row) => Number(row?.nps) > 0);

  const normalizeEmployeeSaveRow = (row, index) => {
    const calculated = calculateEmployee(row);
    const professionTax = toNumber(
      calculated.professionTax ?? calculated.professionalTax
    );
    return {
      ...calculated,
      displayOrder: calculated.displayOrder || index + 1,
      professionTax,
      professionalTax: professionTax,
      incomeTax: toNumber(calculated.incomeTax),
      otherDeduction: toNumber(calculated.otherDeduction),
      nps: toNumber(calculated.nps),
      npsManual: Boolean(calculated.npsManual),
      ta: toNumber(calculated.ta),
      taManual: Boolean(calculated.taManual),
      gpfSubscription: toNumber(calculated.gpfSubscription),
      gpfAdvance: toNumber(calculated.gpfAdvance ?? calculated.gpfAdv),
      gpfAdv: toNumber(calculated.gpfAdvance ?? calculated.gpfAdv),
      /* Persist displayed component amounts; do not force backend auto-NPS. */
      basicDriven: false,
      recalcFromBasic: false,
      fromSnapshot: true,
    };
  };

  /* =========================================================
     GRAND TOTALS
     ========================================================= */

  const totals = useMemo(() => {
    return calculatedEmployees.reduce(
      (total, employee) => {
        total.basicPay +=
          toNumber(employee.basicPay);

        total.fixBasic +=
          toNumber(employee.fixBasic ?? employee.gradePay);

        total.gradePay +=
          toNumber(employee.fixBasic ?? employee.gradePay);

        total.totalBasic +=
          toNumber(employee.totalBasic);

        total.da +=
          toNumber(employee.da);

        total.hra +=
          toNumber(employee.hra);

        total.ma +=
          toNumber(employee.ma);

        total.ta +=
          toNumber(employee.ta);

        total.cla +=
          toNumber(employee.cla);

        total.specialAllowance +=
          toNumber(employee.specialAllowance);

        total.washingAllowance +=
          toNumber(employee.washingAllowance);

        total.grossAmount +=
          toNumber(employee.grossAmount);

        total.gpfSubscription +=
          toNumber(employee.gpfSubscription);

        total.gpfAdvance +=
          toNumber(employee.gpfAdvance ?? employee.gpfAdv);

        total.nps +=
          toNumber(employee.nps);

        total.incomeTax +=
          toNumber(employee.incomeTax);

        total.professionTax += toNumber(
          employee.professionTax ?? employee.professionalTax
        );

        total.otherDeduction +=
          toNumber(employee.otherDeduction);

        total.totalDeduction +=
          toNumber(employee.totalDeduction);

        total.netSalary +=
          toNumber(employee.netSalary);

        total.chequeAmount +=
          toNumber(employee.chequeAmount);

        return total;
      },
      {
        basicPay: 0,
        fixBasic: 0,
        gradePay: 0,
        totalBasic: 0,

        da: 0,
        hra: 0,
        ma: 0,
        ta: 0,
        cla: 0,
        specialAllowance: 0,
        washingAllowance: 0,

        grossAmount: 0,

        gpfSubscription: 0,
        gpfAdvance: 0,
        nps: 0,
        incomeTax: 0,
        professionTax: 0,
        otherDeduction: 0,

        totalDeduction: 0,
        netSalary: 0,
        chequeAmount: 0,
      }
    );
  }, [calculatedEmployees]);

  const visibleEmployees = useMemo(() => {
    const query = salarySearch.trim().toLowerCase();
    if (!query) return calculatedEmployees;
    return calculatedEmployees.filter((employee) =>
      [
        employee.employeeName,
        employee.designation,
        employee.employeeType,
        employee.basicPay,
        employee.netSalary,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [calculatedEmployees, salarySearch]);

  /* =========================================================
     UPDATE EMPLOYEE
     ========================================================= */

  const updateEmployeeValue = (
    employeeId,
    field,
    value
  ) => {
    if (salaryReadOnly) {
      alert(readOnlyReasonMessage());
      return;
    }

    setEmployees((currentEmployees) =>
      currentEmployees.map((employee) => {
        if (!sameEmployeeId(employee.employeeId, employeeId)) {
          return employee;
        }

        const pension = normalizePension(employee);
        if (
          field === "nps" &&
          pension === "GPF"
        ) {
          return employee;
        }
        if (
          (field === "gpfSubscription" ||
            field === "gpfAdv" ||
            field === "gpfAdvance") &&
          pension === "NPS"
        ) {
          return employee;
        }
        if (field === "hra" && employee.hraForcedZero) {
          return employee;
        }

        const numericFields = new Set([
          "basicPay",
          "da",
          "hra",
          "ma",
          "ta",
          "cla",
          "fixBasic",
          "gradePay",
          "specialAllowance",
          "washingAllowance",
          "otherEarnings",
          "nppa",
          "gpfSubscription",
          "gpfAdv",
          "gpfAdvance",
          "nps",
          "incomeTax",
          "professionTax",
          "professionalTax",
          "otherDeduction",
        ]);
        let nextValue = value;
        if (numericFields.has(field) && value !== "" && value != null) {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            return employee;
          }
          nextValue = n;
        }

        /* FIX employees always keep Basic Pay = 0 */
        if (
          field === "basicPay" &&
          String(employee.employeeType || "").toUpperCase() === "FIX"
        ) {
          nextValue = 0;
        }

        let next = {
          ...employee,
          [field]: nextValue,
        };

        if (field === "fixBasic" || field === "gradePay") {
          next.fixBasic = nextValue;
          next.gradePay = nextValue;
        }

        if (field === "professionTax" || field === "professionalTax") {
          next.professionTax = nextValue;
          next.professionalTax = nextValue;
        }

        if (field === "gpfAdv" || field === "gpfAdvance") {
          next.gpfAdv = nextValue;
          next.gpfAdvance = nextValue;
        }

        if (field === "nps") {
          next.npsManual = true;
          next.basicDriven = false;
          next.recalcFromBasic = false;
        }

        if (field === "da") {
          next.daManual = true;
          next.basicDriven = false;
          next.recalcFromBasic = false;
          if (pension === "NPS" && !next.npsManual) {
            const totalBasic =
              (String(next.employeeType || "").toUpperCase() === "FIX"
                ? 0
                : toNumber(next.basicPay)) + resolveFixBasic(next);
            next.nps = calculateNps(totalBasic, nextValue);
          }
        }
        if (field === "hra") {
          next.hraManual = true;
          next.basicDriven = false;
          next.recalcFromBasic = false;
        }

        /*
           A typed TA is the operator's decision and must reach the database
           exactly as entered. Without this flag the save path replaced it
           with the master-derived amount, so Salary Bill Approval showed the
           master TA instead of the entered one.
        */
        if (field === "ta") {
          next.taManual = true;
          next.basicDriven = false;
          next.recalcFromBasic = false;
        }

        /* Basic or FIX Basic change → drive DA / HRA from rates; keep manual NPS */
        if (
          field === "basicPay" ||
          field === "fixBasic" ||
          field === "gradePay"
        ) {
          const basicPay =
            String(next.employeeType || "").toUpperCase() === "FIX"
              ? 0
              : toNumber(next.basicPay);
          const fixBasic = resolveFixBasic(next);
          const prevTotal =
            toNumber(employee.totalBasic ?? employee.totalBasicPay) ||
            toNumber(employee.basicPay) + resolveFixBasic(employee);
          const daRate = resolvePercentRate(
            next.daRate ?? next.daPercentage,
            employee.da,
            prevTotal
          );
          const hraRate = resolvePercentRate(
            next.hraRate ?? next.hraPercentage,
            employee.hra,
            prevTotal
          );
          const derived = calculateSalaryAmounts({
            basic: basicPay,
            fixBasic,
            daPercentage: daRate != null ? daRate : 0,
            hraPercentage: hraRate != null ? hraRate : 0,
            payrollHra: Boolean(next.hraForcedZero),
          });
          const keepManualNps = Boolean(next.npsManual) && pension === "NPS";
          next = {
            ...next,
            basicPay,
            fixBasic,
            gradePay: fixBasic,
            totalBasic: derived.totalBasicPay,
            totalBasicPay: derived.totalBasicPay,
            da: daRate != null ? derived.da : toNumber(next.da),
            hra: next.hraForcedZero
              ? 0
              : hraRate != null
                ? derived.hra
                : toNumber(next.hra),
            daRate: daRate != null ? daRate : next.daRate ?? null,
            hraRate: hraRate != null ? hraRate : next.hraRate ?? null,
            daManual: false,
            hraManual: false,
            taManual: false,
            npsManual: keepManualNps,
            basicDriven: true,
            recalcFromBasic: true,
          };
          if (pension === "NPS") {
            if (!keepManualNps) {
              next.nps = calculateNps(derived.totalBasicPay, next.da);
            }
            next.gpfSubscription = 0;
          } else if (pension === "GPF") {
            next.nps = 0;
            next.npsManual = false;
          }
        }

        return calculateEmployee(next);
      })
    );
    if (field === "basicPay" || field === "fixBasic" || field === "gradePay") {
      const currentBasic =
        field === "basicPay"
          ? value
          : employees.find((employee) =>
              sameEmployeeId(employee.employeeId, employeeId)
            )?.basicPay;
      recalculateTransportAllowance(
        {
          billCode,
          instituteCode,
          employeeId,
          basicPay: currentBasic,
          billMonth,
          salaryMonth,
        },
        user
      )
        .then((result) =>
          setEmployees((rows) =>
            rows.map((row) =>
              sameEmployeeId(row.employeeId, employeeId)
                ? calculateEmployee({
                    ...row,
                    ta: toNumber(result?.data?.ta),
                    /* Master-derived again, so it is no longer a manual TA. */
                    taManual: false,
                    taMasterId: result?.data?.taMasterId,
                    taPayLevelGroup: result?.data?.taPayLevelGroup,
                  })
                : row
            )
          )
        )
        .catch(() => {});
    }
  };

  /* =========================================================
     DRAG START
     ========================================================= */

  const handleDragStart = (
    event,
    employeeId
  ) => {
    setDraggedEmployeeId(employeeId);

    event.dataTransfer.effectAllowed =
      "move";

    event.dataTransfer.setData(
      "text/plain",
      String(employeeId)
    );
  };

  /* =========================================================
     DRAG OVER
     ========================================================= */

  const handleDragOver = (
    event,
    employeeId
  ) => {
    event.preventDefault();

    event.dataTransfer.dropEffect =
      "move";

    if (
      employeeId !== draggedEmployeeId
    ) {
      setDragOverEmployeeId(employeeId);
    }
  };

  /* =========================================================
     DROP
     ========================================================= */

  const handleDrop = (
    event,
    targetEmployeeId
  ) => {
    event.preventDefault();

    if (salaryReadOnly) {
      setDraggedEmployeeId(null);
      setDragOverEmployeeId(null);
      return;
    }

    const sourceEmployeeId =
      draggedEmployeeId ||
      Number(
        event.dataTransfer.getData(
          "text/plain"
        )
      );

    if (!sourceEmployeeId) {
      return;
    }

    if (
      sourceEmployeeId === targetEmployeeId
    ) {
      setDraggedEmployeeId(null);
      setDragOverEmployeeId(null);
      return;
    }

    setEmployees((currentEmployees) => {
      const sourceIndex =
        currentEmployees.findIndex(
          (employee) =>
            employee.employeeId ===
            sourceEmployeeId
        );

      const targetIndex =
        currentEmployees.findIndex(
          (employee) =>
            employee.employeeId ===
            targetEmployeeId
        );

      if (
        sourceIndex === -1 ||
        targetIndex === -1
      ) {
        return currentEmployees;
      }

      const reordered =
        [...currentEmployees];

      const [movedEmployee] =
        reordered.splice(
          sourceIndex,
          1
        );

      reordered.splice(
        targetIndex,
        0,
        movedEmployee
      );

      const withOrder = reordered.map((row, index) => ({
        ...row,
        displayOrder: index + 1,
      }));

      /* Persist DisplayOrder immediately (fire-and-forget with error alert). */
      if (billCode) {
        const orderPayload = withOrder.map((row) => ({
          employeeId: row.employeeId,
          displayOrder: row.displayOrder,
        }));
        saveBillEmployeeOrder(billCode, orderPayload, user).catch((error) => {
          alert(
            error.message ||
              "Unable to save employee order."
          );
        });
      }

      return withOrder;
    });

    setDraggedEmployeeId(null);
    setDragOverEmployeeId(null);
  };

  const handleDragEnd = () => {
    setDraggedEmployeeId(null);
    setDragOverEmployeeId(null);
  };

  /* =========================================================
     SAVE DRAFT
     ========================================================= */

  const handleSaveDraft = async () => {
    if (!billCode) {
      alert("Please select Bill Code.");
      return;
    }

    if (!instituteCode) {
      alert(institutesError || "Please select Institute.");
      return;
    }

    if (salaryReadOnly) {
      alert(readOnlyReasonMessage());
      return;
    }

    if (!employees.length) {
      alert("No employees to save. Click Get Data first.");
      return;
    }

    /*
       NPS Schedule No. is the bank's reference for the NPS remittance, so a
       bill that deducts NPS from anyone cannot be stored without it.
    */
    if (billHasNpsDeduction() && !npsScheduleNo.trim()) {
      alert(
        "Please enter NPS Schedule No. — at least one employee has an NPS deduction."
      );
      return;
    }

    try {
      const guard = await guardSalaryBillCode(activeBillCode || billCode);
      if (guard?.allowed === false) {
        alert(
          guard.message || readOnlyReasonMessage()
        );
        return;
      }
    } catch (error) {
      alert(
        error.message || readOnlyReasonMessage()
      );
      return;
    }

    try {
      const payload = withDisplayOrder(
        employees.map((row, index) => normalizeEmployeeSaveRow(row, index))
      );

      const result = await saveSalaryEntryDraft(
        {
          billCode: activeBillCode || billCode,
          instituteCode,
          sectionId: sectionId || null,
          billMonth,
          salaryMonth,
          billNo: billNo.trim(),
          billDate,
          npsScheduleNo: npsScheduleNo.trim(),
          employees: payload,
        },
        user
      );

      const saved = Array.isArray(result?.data) ? result.data : payload;
      setEmployees(withDisplayOrder(saved));
      setStatus(result?.bill?.status || "DRAFT");
      if (result?.bill?.billMonth) setBillMonth(String(result.bill.billMonth));
      if (result?.bill?.salaryMonth) setSalaryMonth(String(result.bill.salaryMonth));
      if (result?.bill?.billCode) {
        const exactCode = String(result.bill.billCode).trim();
        if (
          returnedMode ||
          /-BM-[A-Z]{3}$/i.test(exactCode) ||
          initialBillMonth
        ) {
          setBillCode(exactCode);
        }
      }
      refreshBillCodesAfterAction();

      alert(result?.message || "Salary Bill saved as Draft.");
    } catch (error) {
      alert(error.message || "Unable to save salary draft.");
    }
  };

  /* =========================================================
     SUBMIT
     ========================================================= */

  const handleSubmitBill = async () => {
    if (!billCode) {
      alert("Please select Bill Code.");
      return;
    }

    if (!instituteCode) {
      alert(institutesError || "Please select Institute.");
      return;
    }

    if (salaryReadOnly) {
      alert(readOnlyReasonMessage());
      return;
    }

    if (!employees.length) {
      alert("No employees to submit. Click Get Data first.");
      return;
    }

    if (!billNo.trim()) {
      alert("Please enter Bill No.");
      return;
    }

    if (!billDate) {
      alert("Please select Bill Date.");
      return;
    }

    /*
       NPS Schedule No. is the bank's reference for the NPS remittance, so a
       bill that deducts NPS from anyone cannot be stored without it.
    */
    if (billHasNpsDeduction() && !npsScheduleNo.trim()) {
      alert(
        "Please enter NPS Schedule No. — at least one employee has an NPS deduction."
      );
      return;
    }

    try {
      const guard = await guardSalaryBillCode(activeBillCode || billCode);
      if (guard?.allowed === false) {
        alert(
          guard.message || readOnlyReasonMessage()
        );
        return;
      }
    } catch (error) {
      alert(
        error.message || readOnlyReasonMessage()
      );
      return;
    }

    try {
      const payload = withDisplayOrder(
        employees.map((row, index) => normalizeEmployeeSaveRow(row, index))
      );
      const result = await submitSalaryEntry(
        {
          billCode: activeBillCode || billCode,
          instituteCode,
          sectionId: sectionId || null,
          billMonth,
          salaryMonth,
          billNo: billNo.trim(),
          billDate,
          npsScheduleNo: npsScheduleNo.trim(),
          employees: payload,
        },
        user
      );
      const saved = Array.isArray(result?.data) ? result.data : payload;
      setEmployees(withDisplayOrder(saved));
      setStatus(result?.bill?.status || "SUBMITTED");
      if (result?.bill?.billMonth) setBillMonth(String(result.bill.billMonth));
      if (result?.bill?.salaryMonth) setSalaryMonth(String(result.bill.salaryMonth));
      if (result?.bill?.billCode) {
        const exactCode = String(result.bill.billCode).trim();
        if (
          returnedMode ||
          /-BM-[A-Z]{3}$/i.test(exactCode) ||
          initialBillMonth
        ) {
          setBillCode(exactCode);
        }
      }
      refreshBillCodesAfterAction();
      alert(result?.message || "Salary Bill submitted successfully.");
    } catch (error) {
      alert(error.message || "Unable to submit salary bill.");
    }
  };

  /* =========================================================
     VARIATION REPORT
     ========================================================= */

  const handleVariationReport = () => {
    if (!billCode) {
      setStatus("Please select Bill Code before opening Variation Report.");
      return;
    }
    if (!instituteCode) {
      setStatus("Please select Institute before opening Variation Report.");
      return;
    }
    setShowVariationReport(true);
  };

  /* =========================================================
     PRINT
     ========================================================= */

  const handlePrint = () => {
    window.print();
  };

  const selectedInstitute =
    institutes.find(
      (item) =>
        item.code === instituteCode
    );

  return (
    <div className="salary-entry-page">
      {showVariationReport && <SalaryEntryVariationReport
        billCode={billCode} billMonth={billMonth} salaryMonth={salaryMonth}
        instituteCode={instituteCode} onClose={() => setShowVariationReport(false)}
      />}

      {/* =====================================================
          HEADER
          ===================================================== */}

      <div className="salary-page-header">

        <div>

          <button
            type="button"
            className="back-link"
            onClick={onBack}
          >
            ← Back to Home
          </button>

          <h1>
            SALARY ENTRY
          </h1>

          <div className="page-subtitle">
            Salary Bill Preparation
          </div>

        </div>

        <div className="logged-user">

          Logged in as:

          <strong>
            {user?.name ||
              "System Administrator"}
          </strong>

        </div>

      </div>

      {isBillCodeLocked && billCode ? (
        <div className="bill-code-locked-banner" role="status">
          <span className="status-badge status-badge-locked">LOCKED</span>
          <span>
            Bill Code {billCode} is locked and cannot be modified.
          </span>
        </div>
      ) : null}

      {isBillCodeCompleted && billCode && !isBillCodeLocked ? (
        <div className="bill-code-status-banner" role="status">
          <span className="status-badge status-badge-completed">COMPLETED</span>
          <span>
            Bill Code {billCode} is completed and cannot be modified.
          </span>
        </div>
      ) : null}

      {billCodesLoading ? (
        <div className="bill-code-load-banner" role="status">
          Loading Bill Codes...
        </div>
      ) : null}

      {!billCodesLoading && billCodesError ? (
        <div className="bill-code-error-banner" role="alert">
          {billCodesError}
        </div>
      ) : null}


      {/* =====================================================
          BILL INFORMATION
          ===================================================== */}

      <section className="salary-card">

        <div className="section-title">
          SALARY BILL INFORMATION
        </div>

        <div className="salary-form-grid">

          {/* BILL MONTH — editable (month when bill is passed/paid) */}

          <div className="form-group">

            <label>
              Bill Month <em>*</em>
            </label>

            <select
              value={billMonth}
              disabled={salaryReadOnly || returnedMode}
              onChange={(e) => {
                setBillMonth(e.target.value);
                setEmployees([]);
                setStatus("DRAFT");
                setGetDataMessage(
                  "Bill Month changed. Click Get Data to load this Bill Month / Salary Month combination."
                );
              }}
            >
              <option value="">
                Select Bill Month
              </option>
              {billMonthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>

            <small>
              Month when this bill is passed/paid
              (e.g. unpaid AUG paid in SEP-26).
            </small>

          </div>


          {/* SALARY MONTH — read-only from Bill Code */}

          <div className="form-group">

            <label>
              Salary Month
            </label>

            <input
              type="text"
              value={salaryMonth}
              readOnly
              placeholder={billCodesLoading ? "Loading..." : "From Bill Code"}
            />

            <small>
              Actual month of this bill (from Bill Code). Not editable.
            </small>

          </div>


          {/* BILL CODE */}

          <div className="form-group">

            <label>
              Bill Code
            </label>

            <select
              value={billCode}
              disabled={
                billCodesLoading ||
                selectableBillCodeRecords.length === 0 ||
                returnedMode
              }
              onChange={(e) =>
                handleBillCodeChange(
                  e.target.value
                )
              }
            >
              {selectableBillCodeRecords.length === 0 ? (
                <option value="">
                  {billCodesLoading
                    ? "Loading Bill Codes..."
                    : "No Bill Codes available"}
                </option>
              ) : (
                selectableBillCodeRecords.map(
                  (row) => (
                    <option
                      key={row.billCodeId || row.id || row.billCode}
                      value={row.billCode}
                    >
                      {row.billCode}
                      {row.status ? ` (${String(row.status).toUpperCase()})` : ""}
                    </option>
                  )
                )
              )}
            </select>
            {billCodeStatus ? (
              <small className="bill-code-status-line">
                Master Status:{" "}
                <span
                  className={
                    isBillCodeLocked
                      ? "status-badge status-badge-locked"
                      : isBillCodeCompleted
                        ? "status-badge status-badge-completed"
                        : "status-badge status-badge-open"
                  }
                >
                  {billCodeStatus}
                </span>
                {isBillCodeLocked || isBillCodeCompleted
                  ? " (read only)"
                  : ""}
              </small>
            ) : null}

          </div>


          {/* INSTITUTE SECTION */}

          <div className="form-group">

            <label>
              Institute Section
            </label>

            <select
              value={sectionId}
              disabled={
                institutesLoading ||
                sections.length === 0 ||
                returnedMode
              }
              onChange={(e) => handleSectionChange(e.target.value)}
            >
              <option value="">All Sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>

          </div>

          {/* INSTITUTE CODE */}

          <div className="form-group">

            <label>
              Institute Code
            </label>

            <select
              value={instituteCode}
              disabled={
                institutesLoading ||
                visibleInstitutes.length === 0 ||
                returnedMode
              }
              onChange={(e) =>
                setInstituteCode(
                  e.target.value
                )
              }
            >
              {visibleInstitutes.length === 0 ? (
                <option value="">
                  {institutesLoading
                    ? "Loading institutes..."
                    : institutesError ||
                      (sectionId
                        ? "No institutes in this section"
                        : "No institutes available")}
                </option>
              ) : (
                visibleInstitutes.map(
                  (institute) => (
                    <option
                      key={institute.id || institute.code}
                      value={institute.code}
                    >
                      {institute.code}
                    </option>
                  )
                )
              )}
            </select>

          </div>


          {/* INSTITUTE NAME */}

          <div className="form-group form-group-wide">

            <label>
              Institute Name
            </label>

            <input
              type="text"
              value={
                selectedInstitute?.name ||
                ""
              }
              readOnly
            />

          </div>


          {/* BILL TYPE */}

          <div className="form-group">

            <label>
              Bill Type
            </label>

            <select
              value={billType}
              disabled={salaryReadOnly}
              onChange={(e) =>
                setBillType(
                  e.target.value
                )
              }
            >
              <option value="Regular">
                Regular
              </option>

              <option value="Supplementary">
                Supplementary
              </option>

              <option value="Arrear">
                Arrear
              </option>

            </select>

          </div>


          {/* BILL NO */}

          <div className="form-group">

            <label>
              Bill No.
            </label>

            <input
              type="text"
              value={billNo}
              readOnly={salaryReadOnly}
              onChange={(e) =>
                setBillNo(
                  e.target.value
                )
              }
              placeholder="Enter Bill No."
            />

          </div>


          {/* BILL DATE */}

          <div className="form-group">

            <label>
              Bill Date
            </label>

            <input
              type="date"
              value={billDate}
              readOnly={salaryReadOnly}
              disabled={salaryReadOnly}
              onChange={(e) =>
                setBillDate(
                  e.target.value
                )
              }
            />

          </div>


          {/* NPS SCHEDULE */}

          <div className="form-group">

            <label>
              NPS Schedule No.
            </label>

            <input
              type="text"
              value={npsScheduleNo}
              readOnly={salaryReadOnly}
              onChange={(e) =>
                setNpsScheduleNo(
                  e.target.value
                )
              }
              placeholder="NPS Schedule No."
            />

          </div>

        </div>


        <div className="form-actions">

          <button
            type="button"
            className="btn btn-primary"
            disabled={billCodesLoading}
            onClick={handleGetData}
          >
            🔍 Get Data
          </button>

          {getDataMessage ? (
            <div className="get-data-message">
              {getDataMessage}
            </div>
          ) : null}

          {incrementNotices.length ? (
            <div className="increment-notice">
              <div className="increment-notice-head">
                Increment applied automatically to {incrementNotices.length}{" "}
                employee{incrementNotices.length === 1 ? "" : "s"} for this
                salary month — Basic Pay below is already updated, no manual
                change is needed.
              </div>
              <ul>
                {incrementNotices.slice(0, 10).map((notice) => (
                  <li key={notice.employeeId}>
                    <strong>{notice.employeeName}</strong> — {notice.message}
                    {notice.appliedNow ? (
                      <span className="increment-notice-tag">
                        recorded on Save
                      </span>
                    ) : null}
                  </li>
                ))}
                {incrementNotices.length > 10 ? (
                  <li>…and {incrementNotices.length - 10} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

        </div>

      </section>


      {/* =====================================================
          MONTH INFORMATION
          ===================================================== */}

      <div className="month-info">

        <strong>
          Bill Month:
        </strong>

        {" "}

        {billMonth || "-"}

        <span className="month-arrow">
          →
        </span>

        <strong>
          Salary Month:
        </strong>

        {" "}

        {salaryMonth || "-"}

        <span className="month-description">

          {!salaryMonth
            ? "Select a Bill Code to load Salary Month."
            : !billMonth
              ? "Select Bill Month (when this bill is passed/paid)."
              : `Salary Month ${salaryMonth} bill is being passed/paid in Bill Month ${billMonth}.`}

        </span>

      </div>


      {/* =====================================================
          STATUS
          ===================================================== */}

      <div className="status-card">

        <span>
          Institute Status
        </span>

        <span className="status-badge">
          {status || "-"}
        </span>

      </div>


      {/* =====================================================
          EMPLOYEE GRID
          ===================================================== */}

      <section className="salary-grid-card">

        <div className="section-title">
          EMPLOYEE SALARY DETAILS
        </div>

        <div className="drag-help">
          ↕ Drag an employee row and
          drop it on another employee
          to change the employee order.
        </div>

        <GridToolbar
          title="Employee Salary Details"
          columns={[
            { key: "employeeId", label: "Employee ID" },
            { key: "employeeName", label: "Employee Name" },
            { key: "designation", label: "Designation" },
            { key: "employeeType", label: "Employee Type" },
            { key: "pension", label: "Pension" },
            { key: "basicPay", label: "Basic" },
            { key: "fixBasic", label: "FIX Basic" },
            { key: "totalBasic", label: "Total Basic Pay" },
            { key: "da", label: "DA" },
            { key: "hra", label: "HRA" },
            { key: "ma", label: "MA" },
            { key: "ta", label: "TA" },
            { key: "cla", label: "CLA" },
            { key: "specialAllowance", label: "Special Allowance" },
            { key: "washingAllowance", label: "Washing Allowance" },
            { key: "grossAmount", label: "Gross Amount" },
            { key: "gpfSubscription", label: "GPF Subscription" },
            { key: "gpfAdvance", label: "GPF Adv" },
            { key: "nps", label: "NPS" },
            { key: "incomeTax", label: "Income Tax" },
            { key: "professionTax", label: "Professional Tax" },
            { key: "otherDeduction", label: "Other Deduction" },
            { key: "totalDeduction", label: "Total Deduction" },
            { key: "netSalary", label: "Net Salary" },
            { key: "chequeAmount", label: "Cheque Amount" },
          ]}
          rows={calculatedEmployees}
          visibleKeys={{}}
          search={salarySearch}
          onSearchChange={setSalarySearch}
          showSearch={true}
        />

        <div className="salary-table-wrapper">

          <table className="salary-table">

            <thead>

              {/* MAIN HEADER */}

              <tr className="group-header">

                <th
                  rowSpan="2"
                  className="sticky-col sr-col"
                >
                  Sr. No.
                </th>

                <th
                  rowSpan="2"
                  className="sticky-col empid-col"
                >
                  Employee ID
                </th>

                <th
                  rowSpan="2"
                  className="sticky-col name-col"
                >
                  Name
                </th>

                <th
                  rowSpan="2"
                  className="sticky-col designation-col"
                >
                  Designation
                </th>

                <th
                  rowSpan="2"
                  className="sticky-col type-col"
                >
                  Type
                </th>

                <th
                  rowSpan="2"
                  className="sticky-col pension-col"
                >
                  Pension
                </th>

                <th
                  colSpan="10"
                  className="earning-header"
                >
                  EARNING
                </th>

                <th
                  colSpan="9"
                  className="deduction-header"
                >
                  DEDUCTION
                </th>

              </tr>


              {/* SUB HEADER */}

              <tr className="column-header">

                {/* EARNING */}

                <th>
                  Basic
                </th>

                <th>
                  FIX Basic
                </th>

                <th>
                  Total Basic Pay
                </th>

                <th>
                  DA
                </th>

                <th>
                  HRA
                </th>

                <th>
                  MA
                </th>

                <th>
                  TA
                </th>

                <th>
                  CLA
                </th>

                <th>
                  Special Allow.
                </th>

                <th>
                  Washing Allow.
                </th>


                {/* DEDUCTION */}

                <th>
                  Gross Salary
                </th>

                <th>
                  GPF Subscription
                </th>

                <th>
                  GPF Adv
                </th>

                <th>
                  NPS
                </th>

                <th>
                  Income Tax
                </th>

                <th>
                  Professional Tax
                </th>

                <th>
                  Other Deduction
                </th>

                <th>
                  Total Deduction
                </th>

                <th>
                  Net Salary
                </th>

              </tr>

            </thead>


            {/* =================================================
                BODY
                ================================================= */}

            <tbody>

              {visibleEmployees.map(
                (employee, index) => {

                  const isDragging =
                    draggedEmployeeId ===
                    employee.employeeId;

                  const isDragOver =
                    dragOverEmployeeId ===
                    employee.employeeId;

                  return (

                    <tr
                      key={
                        employee.employeeId
                      }

                      draggable={!salaryReadOnly}

                      onDragStart={(event) =>
                        handleDragStart(
                          event,
                          employee.employeeId
                        )
                      }

                      onDragOver={(event) =>
                        handleDragOver(
                          event,
                          employee.employeeId
                        )
                      }

                      onDrop={(event) =>
                        handleDrop(
                          event,
                          employee.employeeId
                        )
                      }

                      onDragEnd={
                        handleDragEnd
                      }

                      onClick={() =>
                        setSelectedEmployeeId(employee.employeeId)
                      }

                      className={`
                        employee-row
                        ${
                          isDragging
                            ? "dragging"
                            : ""
                        }
                        ${
                          isDragOver
                            ? "drag-over"
                            : ""
                        }
                        ${
                          selectedEmployeeId === employee.employeeId
                            ? "is-selected"
                            : ""
                        }
                      `}
                    >

                      {/* SR NO */}

                      <td className="sticky-col sr-col">

                        <span className="drag-handle">
                          ⋮⋮
                        </span>

                        {index + 1}

                      </td>

                      <td className="sticky-col empid-col">
                        {employee.employeeId}
                      </td>

                      {/* NAME */}

                      <td className="sticky-col name-col">
                        {
                          employee.employeeName
                        }
                      </td>


                      {/* DESIGNATION */}

                      <td className="sticky-col designation-col">
                        {
                          employee.designation
                        }
                      </td>


                      {/* TYPE */}

                      <td className="sticky-col type-col">

                        <span
                          className={`
                            employee-type
                            ${
                              String(employee.employeeType || "").toUpperCase() ===
                              "FIX"
                                ? "type-nps"
                                : "type-gpf"
                            }
                          `}
                        >
                          {
                            employee.employeeType
                          }
                        </span>

                      </td>

                      <td className="sticky-col pension-col">
                        {normalizePension(employee) || "-"}
                      </td>


                      {/* BASIC PAY */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={
                            salaryReadOnly ||
                            String(employee.employeeType || "").toUpperCase() ===
                              "FIX"
                          }
                          value={
                            String(employee.employeeType || "").toUpperCase() ===
                            "FIX"
                              ? 0
                              : employee.basicPay
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "basicPay",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* FIX BASIC */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.fixBasic ?? employee.gradePay ?? 0
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "fixBasic",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* TOTAL BASIC PAY */}

                      <td className="calculated-cell">
                        {money(
                          employee.totalBasic
                        )}
                      </td>


                      {/* DA */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.da
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "da",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* HRA */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={
                            salaryReadOnly || Boolean(employee.hraForcedZero)
                          }
                          value={
                            employee.hraForcedZero ? 0 : employee.hra
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "hra",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* MA */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.ma
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "ma",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* TA */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.ta
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "ta",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* CLA */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.cla ?? 0
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "cla",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* SPECIAL */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.specialAllowance
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "specialAllowance",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* WASHING */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.washingAllowance
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "washingAllowance",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* GROSS SALARY */}

                      <td className="calculated-cell gross-cell">
                        {money(
                          employee.grossAmount
                        )}
                      </td>


                      {/* GPF SUBSCRIPTION */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={
                            salaryReadOnly ||
                            normalizePension(employee) === "NPS"
                          }
                          disabled={normalizePension(employee) === "NPS"}
                          value={
                            employee.gpfSubscription
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "gpfSubscription",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* GPF ADV */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={
                            salaryReadOnly ||
                            normalizePension(employee) === "NPS"
                          }
                          disabled={normalizePension(employee) === "NPS"}
                          value={
                            employee.gpfAdvance ?? employee.gpfAdv ?? ""
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "gpfAdvance",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* NPS */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={
                            salaryReadOnly ||
                            normalizePension(employee) === "GPF"
                          }
                          disabled={normalizePension(employee) === "GPF"}
                          value={
                            employee.nps ?? ""
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "nps",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* INCOME TAX */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.incomeTax ?? ""
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "incomeTax",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* PROFESSIONAL TAX */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.professionTax ??
                            employee.professionalTax ??
                            ""
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "professionTax",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* OTHER DEDUCTION */}

                      <td>
                        <input
                          type="number"
                          min="0"
                          readOnly={salaryReadOnly}
                          value={
                            employee.otherDeduction ?? ""
                          }
                          onChange={(e) =>
                            updateEmployeeValue(
                              employee.employeeId,
                              "otherDeduction",
                              e.target.value
                            )
                          }
                        />
                      </td>


                      {/* TOTAL DEDUCTION */}

                      <td className="calculated-cell deduction-total">

                        {money(
                          employee.totalDeduction
                        )}

                      </td>


                      {/* NET SALARY */}

                      <td className="calculated-cell net-cell">

                        {money(
                          employee.netSalary
                        )}

                      </td>

                    </tr>
                  );
                }
              )}

            </tbody>


            {/* =================================================
                TOTAL
                ================================================= */}

            <tfoot>

              <tr className="total-row">

                <td className="sticky-col sr-col total-label">
                  TOTAL
                </td>
                <td className="sticky-col empid-col"></td>
                <td className="sticky-col name-col"></td>
                <td className="sticky-col designation-col"></td>
                <td className="sticky-col type-col"></td>
                <td className="sticky-col pension-col"></td>

                <td>
                  {money(
                    totals.basicPay
                  )}
                </td>

                <td>
                  {money(
                    totals.fixBasic || totals.gradePay
                  )}
                </td>

                <td>
                  {money(
                    totals.totalBasic
                  )}
                </td>

                <td>
                  {money(
                    totals.da
                  )}
                </td>

                <td>
                  {money(
                    totals.hra
                  )}
                </td>

                <td>
                  {money(
                    totals.ma
                  )}
                </td>

                <td>
                  {money(
                    totals.ta
                  )}
                </td>

                <td>
                  {money(
                    totals.cla || 0
                  )}
                </td>

                <td>
                  {money(
                    totals.specialAllowance
                  )}
                </td>

                <td>
                  {money(
                    totals.washingAllowance
                  )}
                </td>

                <td>
                  {money(
                    totals.grossAmount
                  )}
                </td>

                <td>
                  {money(
                    totals.gpfSubscription
                  )}
                </td>

                <td>
                  {money(
                    totals.gpfAdvance
                  )}
                </td>

                <td>
                  {money(
                    totals.nps
                  )}
                </td>

                <td>
                  {money(
                    totals.incomeTax
                  )}
                </td>

                <td>
                  {money(
                    totals.professionTax
                  )}
                </td>

                <td>
                  {money(
                    totals.otherDeduction
                  )}
                </td>

                <td>
                  {money(
                    totals.totalDeduction
                  )}
                </td>

                <td>
                  {money(
                    totals.netSalary
                  )}
                </td>

              </tr>

            </tfoot>

          </table>

        </div>

      </section>


      {/* =====================================================
          REMARKS
          ===================================================== */}

      <section className="remarks-card">

        <label>
          Remarks
        </label>

        <textarea
          value={remarks}
          readOnly={salaryReadOnly}
          onChange={(e) =>
            setRemarks(
              e.target.value
            )
          }
          placeholder="Enter remarks..."
        />

      </section>


      {/* =====================================================
          SUMMARY
          ===================================================== */}

      <div className="summary-grid">

        <div className="summary-box">

          <span>
            Employees
          </span>

          <strong>
            {calculatedEmployees.length}
          </strong>

        </div>


        <div className="summary-box">

          <span>
            Gross Salary
          </span>

          <strong>
            ₹ {money(
              totals.grossAmount
            )}
          </strong>

        </div>


        <div className="summary-box">

          <span>
            Total Deduction
          </span>

          <strong>
            ₹ {money(
              totals.totalDeduction
            )}
          </strong>

        </div>


        <div className="summary-box">

          <span>
            Net Salary
          </span>

          <strong>
            ₹ {money(
              totals.netSalary
            )}
          </strong>

        </div>


        <div className="summary-box">

          <span>
            Cheque Amount
          </span>

          <strong>
            ₹ {money(
              totals.netSalary
            )}
          </strong>

        </div>

      </div>


      {/* =====================================================
          ACTION BUTTONS
          ===================================================== */}

      <div className="footer-actions">

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onBack}
        >
          Close
        </button>

        <button
          type="button"
          className="btn btn-variation"
          onClick={
            handleVariationReport
          }
        >
          📊 Variation Report
        </button>

        <button
          type="button"
          className="btn btn-print"
          onClick={handlePrint}
        >
          🖨 Print
        </button>

        <button
          type="button"
          className="btn btn-save"
          disabled={salaryReadOnly}
          onClick={
            handleSaveDraft
          }
        >
          💾 Save Draft
        </button>

        <button
          type="button"
          className="btn btn-submit"
          disabled={salaryReadOnly}
          onClick={
            handleSubmitBill
          }
        >
          ✓ Submit Bill
        </button>

      </div>

    </div>
  );
}
