import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import ModuleFrame from "../components/ModuleFrame";
import DataGrid, { GridActions } from "../components/DataGrid";
import { listInstitutes } from "../utils/instituteApi";
import { sortInstitutesByCode } from "../utils/instituteCodeSort";
import { listActiveDesignations } from "../utils/designationApi";
import { listActiveSections } from "../utils/sectionApi";
import { listActivePayRevisions } from "../utils/payRevisionApi";
import {
  listPayLevels,
  listPayCells,
  getBasicPay,
} from "../utils/payMatrixApi";
import {
  createEmployee,
  updateEmployee,
  listEmployees,
  getNextEmployeeId,
} from "../utils/employeeApi";
import "../employeeMaster.css";

const EMPTY = {
  id: "",
  employeeId: "",
  employeeName: "",
  designation: "",
  designationId: "",
  employeeType: "REGULAR",
  instituteId: "",
  instituteCode: "",
  instituteName: "",
  district: "",
  cityClass: "",
  sectionId: "",
  payRevisionId: "",
  payLevel: "",
  payMatrixCellNo: "",
  payMatrixId: "",
  scaleOfPay: "",
  basicPay: "",
  dateOfJoining: "",
  dateOfFullPay: "",
  dateOfBirth: "",
  dateOfRetirement: "",
  monthOfIncrement: "",
  gpfNps: "",
  gpfNpsNumber: "",
  cccPassDate: "",
  bankAccountNumber: "",
  status: "Active",
};

const EMPTY_SEARCH = {
  employeeId: "",
  employeeName: "",
  institute: "",
  designation: "",
  status: "",
};

function isValidBankAccount(value) {
  if (value == null || String(value).trim() === "") return true;
  return /^\d+$/.test(String(value).trim());
}

/** UI label "Cell 29" → 29; leave numeric values as-is. */
function normalizePayMatrixCellNo(value) {
  if (value == null || value === "") return null;
  const raw = String(value)
    .replace(/,/g, "")
    .replace(/^(cell|cellno|cell\s*no\.?)\s*/i, "")
    .trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > 1e-9 || rounded < 1) return null;
  return rounded;
}

function moneyDisplay(value) {
  if (value === "" || value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toDateInput(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function mapApiEmployee(e) {
  const type =
    String(e.employeeType || "REGULAR").toUpperCase() === "FIX"
      ? "FIX"
      : "REGULAR";
  return {
    id: e.employeeId,
    employeeId: String(e.employeeId ?? e.employeeCode ?? ""),
    employeeName: e.employeeName || "",
    designation: e.designationName || "",
    designationId: e.designationId || "",
    employeeType: type,
    instituteId: e.instituteId || "",
    instituteCode: e.instituteCode || "",
    instituteName: e.instituteName || "",
    sectionId: e.sectionId || "",
    district: e.districtName || "",
    cityClass: e.cityClassName || "",
    payRevisionId: e.payRevisionId || "",
    payLevel: e.payLevel != null ? String(e.payLevel) : "",
    payMatrixCellNo:
      e.payMatrixCellNo != null
        ? String(e.payMatrixCellNo)
        : e.payMatrixCell != null
          ? String(e.payMatrixCell)
          : "",
    payMatrixId: e.payMatrixId || "",
    basicPay:
      type === "FIX" ? "0" : e.basicPay != null ? String(e.basicPay) : "",
    dateOfJoining: toDateInput(e.dateOfJoining),
    dateOfFullPay: toDateInput(e.dateOfFullPay),
    dateOfBirth: toDateInput(e.dateOfBirth),
    dateOfRetirement: toDateInput(e.dateOfRetirement),
    monthOfIncrement:
      e.monthOfIncrement == null || e.monthOfIncrement === ""
        ? ""
        : String(e.monthOfIncrement),
    gpfNps: e.gpfNps || "",
    gpfNpsNumber: e.gpfNpsNumber || "",
    cccPassDate: toDateInput(e.cccPassDate),
    bankAccountNumber: e.bankAccountNumber || "",
    status: e.status || "Active",
    scaleOfPay: e.scaleOfPay || "",
  };
}

export default function EmployeeMaster({ onBack, user }) {
  const [form, setForm] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const [applied, setApplied] = useState(EMPTY_SEARCH);
  const [message, setMessage] = useState("");
  const [bankError, setBankError] = useState("");
  const [institutes, setInstitutes] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [sections, setSections] = useState([]);
  const [payRevisionId, setPayRevisionId] = useState("");
  const [levels, setLevels] = useState([]);
  const [cells, setCells] = useState([]);
  const [saving, setSaving] = useState(false);

  const isFix = form.employeeType === "FIX";
  const isEditMode = Boolean(form.id);

  const refreshEmployees = async () => {
    const employeeData = await listEmployees();
    setRows(
      Array.isArray(employeeData) ? employeeData.map(mapApiEmployee) : []
    );
  };

  const prepareNewForm = async (keepMessage = "") => {
    try {
      const nextId = await getNextEmployeeId();
      setForm({
        ...EMPTY,
        employeeId: nextId != null ? String(nextId) : "",
      });
      setBankError("");
      setMessage(keepMessage || "");
    } catch (error) {
      setForm(EMPTY);
      setMessage(error.message || "Unable to load next Employee ID.");
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      listInstitutes(),
      listActiveDesignations(),
      listActiveSections().catch(() => []),
      listActivePayRevisions().catch(() => []),
      listEmployees().catch(() => []),
    ])
      .then(
        ([
          instituteData,
          designationData,
          sectionData,
          revisionData,
          employeeData,
        ]) => {
          if (!active) return;
          setInstitutes(Array.isArray(instituteData) ? instituteData : []);
          setDesignations(Array.isArray(designationData) ? designationData : []);
          setSections(Array.isArray(sectionData) ? sectionData : []);
          const revisions = Array.isArray(revisionData) ? revisionData : [];
          const activeRev =
            revisions.find((r) => r.isActive !== false) || revisions[0];
          if (activeRev) {
            setPayRevisionId(String(activeRev.payRevisionId || activeRev.id));
          }
          if (Array.isArray(employeeData)) {
            setRows(employeeData.map(mapApiEmployee));
          }
          prepareNewForm();
        }
      )
      .catch(() => {
        if (!active) return;
        setInstitutes([]);
        setDesignations([]);
        prepareNewForm();
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!payRevisionId || isFix) {
      setLevels([]);
      return;
    }
    let active = true;
    listPayLevels(payRevisionId)
      .then((data) => {
        if (active) setLevels(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setLevels([]);
      });
    return () => {
      active = false;
    };
  }, [payRevisionId, isFix]);

  useEffect(() => {
    if (!payRevisionId || !form.payLevel || isFix) {
      setCells([]);
      return;
    }
    let active = true;
    listPayCells(payRevisionId, form.payLevel)
      .then((data) => {
        if (active) setCells(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setCells([]);
      });
    return () => {
      active = false;
    };
  }, [payRevisionId, form.payLevel, isFix]);

  const setField = (name) => (event) => {
    setForm((prev) => ({ ...prev, [name]: event.target.value }));
    setMessage("");
  };

  const handleEmployeeIdChange = () => {
    /* Employee ID is auto-generated and read-only */
  };

  const handleBankChange = (event) => {
    const digits = String(event.target.value || "").replace(/\D/g, "");
    setForm((prev) => ({ ...prev, bankAccountNumber: digits }));
    setBankError("");
    setMessage("");
  };

  const handleInstituteCodeChange = (event) => {
    const code = event.target.value;
    const selected = institutes.find(
      (row) => String(row.instituteCode) === String(code)
    );

    setForm((prev) => ({
      ...prev,
      instituteCode: code,
      instituteId: selected?.instituteId || selected?.id || "",
      instituteName: selected?.instituteName || "",
      district:
        selected?.districtName ||
        selected?.instituteDistrict ||
        selected?.district ||
        "",
      cityClass:
        selected?.cityClassName ||
        selected?.cityClass ||
        "",
      sectionId: selected?.sectionId || prev.sectionId || "",
    }));
    setMessage("");
  };

  const handleEmployeeTypeChange = (event) => {
    const employeeType = String(event.target.value || "").toUpperCase();
    setMessage("");
    if (employeeType === "FIX") {
      setForm((prev) => ({
        ...prev,
        employeeType: "FIX",
        payLevel: "",
        payMatrixCellNo: "",
        payMatrixId: "",
        basicPay: "0",
      }));
      setCells([]);
      return;
    }
    setForm((prev) => ({
      ...prev,
      employeeType: "REGULAR",
      payLevel: "",
      payMatrixCellNo: "",
      payMatrixId: "",
      basicPay: "",
    }));
  };

  const handleDesignationChange = (event) => {
    const designationId = event.target.value;
    const selected = designations.find(
      (row) => String(row.designationId || row.id) === String(designationId)
    );
    setForm((prev) => ({
      ...prev,
      designationId,
      designation: selected?.designationName || "",
    }));
    setMessage("");
  };

  const handlePayLevelChange = (event) => {
    const payLevel = event.target.value;
    setForm((prev) => ({
      ...prev,
      payLevel,
      payMatrixCellNo: "",
      payMatrixId: "",
      basicPay: "",
    }));
    setMessage("");
  };

  const handlePayCellChange = async (event) => {
    const rawCell = event.target.value;
    const payMatrixCellNo = normalizePayMatrixCellNo(rawCell);
    const payLevel = String(form.payLevel || "").trim();
    setMessage("");
    if (payMatrixCellNo == null || !payLevel || !payRevisionId) {
      setForm((prev) => ({
        ...prev,
        payMatrixCellNo: "",
        payMatrixId: "",
        basicPay: "",
      }));
      return;
    }
    try {
      const data = await getBasicPay(payRevisionId, payLevel, payMatrixCellNo);
      setForm((prev) => ({
        ...prev,
        payMatrixCellNo: String(payMatrixCellNo),
        payMatrixId: data?.payMatrixId || "",
        payRevisionId: data?.payRevisionId || payRevisionId,
        basicPay: data?.basicPay != null ? String(data.basicPay) : "",
      }));
    } catch (error) {
      setForm((prev) => ({
        ...prev,
        payMatrixCellNo: String(payMatrixCellNo),
        payMatrixId: "",
        basicPay: "",
      }));
      setMessage(error.message || "Unable to load Basic Pay from Pay Matrix.");
    }
  };

  const instituteOptions = useMemo(() => {
    const activeRows = institutes.filter(
      (row) => String(row.status || "Active").toUpperCase() === "ACTIVE"
    );
    const codes = new Set(activeRows.map((row) => String(row.instituteCode || "")));
    if (form.instituteCode && !codes.has(String(form.instituteCode))) {
      const fallback =
        institutes.find(
          (row) => String(row.instituteCode) === String(form.instituteCode)
        ) || {
          instituteCode: form.instituteCode,
          instituteName: form.instituteName,
          instituteDistrict: form.district,
          cityClass: form.cityClass,
        };
      /* Natural InstituteCode order (never InstituteId); the fallback stays
         visible in its natural position so an edit never strands. */
      return sortInstitutesByCode([...activeRows, fallback]);
    }
    return sortInstitutesByCode(activeRows);
  }, [institutes, form.instituteCode, form.instituteName, form.district, form.cityClass]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      return (
        (!applied.employeeId ||
          String(row.employeeId)
            .toLowerCase()
            .includes(applied.employeeId.toLowerCase())) &&
        (!applied.employeeName ||
          row.employeeName
            .toLowerCase()
            .includes(applied.employeeName.toLowerCase())) &&
        (!applied.institute ||
          String(row.instituteName || "")
            .toLowerCase()
            .includes(applied.institute.toLowerCase()) ||
          String(row.instituteCode || "")
            .toLowerCase()
            .includes(applied.institute.toLowerCase())) &&
        (!applied.designation || row.designation === applied.designation) &&
        (!applied.status || row.status === applied.status)
      );
    });
  }, [rows, applied]);

  const save = async (event) => {
    event.preventDefault();
    setMessage("");

    if (!form.employeeName.trim()) {
      setMessage("Employee Name is required.");
      return;
    }
    if (!form.designationId) {
      setMessage("Please select Designation.");
      return;
    }
    if (!form.instituteCode.trim() || !form.instituteId) {
      setMessage("Please select Institute Code.");
      return;
    }
    const employeeType = String(form.employeeType || "").toUpperCase();
    if (employeeType !== "REGULAR" && employeeType !== "FIX") {
      setMessage("Invalid Employee Type.");
      return;
    }
    if (employeeType === "REGULAR") {
      if (!form.payLevel || !form.payMatrixCellNo) {
        setMessage("Pay Level and Pay Matrix Cell are required for REGULAR employees.");
        return;
      }
      if (!payRevisionId) {
        setMessage("No active Pay Revision / Pay Matrix is available.");
        return;
      }
      if (normalizePayMatrixCellNo(form.payMatrixCellNo) == null) {
        setMessage("Pay Matrix Cell must be a valid cell number.");
        return;
      }
    }
    if (!isValidBankAccount(form.bankAccountNumber)) {
      setBankError("Bank Account Number must contain only numeric characters.");
      setMessage("Bank Account Number must contain only numeric characters.");
      return;
    }
    if (!form.dateOfJoining || !form.dateOfBirth) {
      setMessage("Date of Joining and Date of Birth are required.");
      return;
    }

    const level =
      employeeType === "REGULAR"
        ? String(form.payLevel || "").trim()
        : null;
    const cellNo =
      employeeType === "REGULAR"
        ? normalizePayMatrixCellNo(form.payMatrixCellNo)
        : null;
    const revisionId =
      employeeType === "REGULAR" ? Number(payRevisionId) : null;

    const payload = {
      employeeId:
        employeeType && form.employeeId
          ? Number(form.employeeId)
          : form.employeeId || null,
      employeeName: form.employeeName.trim(),
      designationId: Number(form.designationId),
      instituteId: Number(form.instituteId),
      sectionId: form.sectionId || null,
      employeeType,
      payRevisionId: revisionId,
      payLevel: level,
      level,
      payMatrixCellNo: cellNo,
      cellNo,
      dateOfJoining: form.dateOfJoining,
      dateOfFullPay: form.dateOfFullPay || null,
      dateOfBirth: form.dateOfBirth,
      dateOfRetirement: form.dateOfRetirement || null,
      monthOfIncrement:
        form.monthOfIncrement === "" || form.monthOfIncrement == null
          ? null
          : Number(form.monthOfIncrement),
      cccPassDate: form.cccPassDate || null,
      status: form.status || "Active",
      scaleOfPay: form.scaleOfPay || null,
      gpfNps: form.gpfNps || null,
      gpfNpsNumber: form.gpfNpsNumber || null,
      bankAccountNumber: form.bankAccountNumber || null,
    };

    setSaving(true);
    try {
      if (isEditMode) {
        await updateEmployee(form.id, payload, user);
        setMessage(
          `Employee updated successfully. Employee ID: ${form.employeeId}`
        );
        await refreshEmployees();
        await prepareNewForm(
          `Employee updated successfully. Employee ID: ${form.employeeId}`
        );
      } else {
        const result = await createEmployee(payload, user);
        const savedId =
          result?.data?.employeeId ?? result?.employeeId ?? form.employeeId;
        const successMsg =
          result?.message ||
          `Employee saved successfully. Employee ID: ${savedId}`;
        await refreshEmployees();
        /* Load next ID only after successful INSERT. */
        await prepareNewForm(successMsg);
      }
      setBankError("");
    } catch (error) {
      /* Keep current Employee ID and form values on failure. */
      setMessage(error.message || "Unable to save employee.");
    } finally {
      setSaving(false);
    }
  };

  const loadForEdit = async (row) => {
    const type =
      String(row.employeeType || "REGULAR").toUpperCase() === "FIX"
        ? "FIX"
        : "REGULAR";
    const revision =
      row.payRevisionId || payRevisionId
        ? String(row.payRevisionId || payRevisionId)
        : "";
    if (revision) setPayRevisionId(revision);

    setForm({
      ...EMPTY,
      ...row,
      id: row.id || row.employeeId,
      employeeId: String(row.employeeId),
      employeeType: type,
      designationId: row.designationId || "",
      payLevel: type === "FIX" ? "" : row.payLevel || "",
      payMatrixCellNo: type === "FIX" ? "" : row.payMatrixCellNo || "",
      basicPay: type === "FIX" ? "0" : row.basicPay || "",
    });
    setMessage("");

    if (type === "REGULAR" && revision && row.payLevel && row.payMatrixCellNo) {
      try {
        const data = await getBasicPay(revision, row.payLevel, row.payMatrixCellNo);
        setForm((prev) => ({
          ...prev,
          basicPay: data?.basicPay != null ? String(data.basicPay) : prev.basicPay,
          payMatrixId: data?.payMatrixId || prev.payMatrixId,
        }));
      } catch {
        /* keep stored basic */
      }
    }
  };

  return (
    <ModuleFrame title="EMPLOYEE MASTER" onBack={onBack}>
      <div className="emp-master">
        <section className="hr-card">
          <div className="hr-card-head">
            <span>EMPLOYEE INFORMATION</span>
            <Breadcrumb className="hr-crumb" section="Masters" current="Employee Master" />
          </div>
          <form className="hr-card-body" onSubmit={save}>
            <div className="emp-grid">
              <Field label="Employee ID" required>
                <input
                  value={form.employeeId}
                  readOnly
                  disabled
                  className="emp-readonly"
                  onChange={handleEmployeeIdChange}
                  title="Auto-generated Employee ID"
                />
              </Field>
              <Field label="Employee Name" required>
                <input
                  value={form.employeeName}
                  onChange={setField("employeeName")}
                />
              </Field>
              <Field label="Designation" required>
                <select
                  value={form.designationId}
                  onChange={handleDesignationChange}
                >
                  <option value="">Select</option>
                  {designations.map((row) => (
                    <option
                      key={row.designationId || row.id}
                      value={row.designationId || row.id}
                    >
                      {row.designationName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employee Type" required>
                <select
                  value={form.employeeType}
                  onChange={handleEmployeeTypeChange}
                >
                  <option value="">Select</option>
                  <option value="REGULAR">REGULAR</option>
                  <option value="FIX">FIX</option>
                </select>
              </Field>
              <Field label="Institute Code" required>
                <select
                  value={form.instituteCode}
                  onChange={handleInstituteCodeChange}
                >
                  <option value="">Select</option>
                  {instituteOptions.map((row) => (
                    <option
                      key={row.instituteId || row.id || row.instituteCode}
                      value={row.instituteCode}
                    >
                      {row.instituteCode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Institute Name">
                <input
                  value={form.instituteName}
                  readOnly
                  className="emp-readonly"
                  placeholder="Auto filled from Institute Code"
                />
              </Field>
              <Field label="District">
                <input
                  value={form.district}
                  readOnly
                  className="emp-readonly"
                  placeholder="Auto filled from Institute Code"
                />
              </Field>
              <Field label="City Class">
                <input
                  value={form.cityClass}
                  readOnly
                  className="emp-readonly"
                  placeholder="Auto filled from Institute Code"
                />
              </Field>
              <Field label="Section">
                <select
                  value={form.sectionId}
                  onChange={setField("sectionId")}
                >
                  <option value="">Select</option>
                  {sections.map((row) => (
                    <option
                      key={row.sectionId || row.id}
                      value={row.sectionId || row.id}
                    >
                      {row.sectionName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pay Level" required={!isFix}>
                <select
                  value={form.payLevel}
                  onChange={handlePayLevelChange}
                  disabled={isFix || !payRevisionId}
                >
                  <option value="">Select</option>
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pay Matrix Cell" required={!isFix}>
                <select
                  value={form.payMatrixCellNo}
                  onChange={handlePayCellChange}
                  disabled={isFix || !form.payLevel}
                >
                  <option value="">Select</option>
                  {cells.map((cell) => (
                    <option key={cell.cellNo} value={String(cell.cellNo)}>
                      Cell {cell.cellNo}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Basic Pay">
                <input
                  value={
                    isFix
                      ? moneyDisplay(0)
                      : form.basicPay === ""
                        ? ""
                        : moneyDisplay(form.basicPay)
                  }
                  readOnly
                  className="emp-readonly"
                  placeholder={
                    isFix
                      ? "0 for FIX employee"
                      : "From Pay Matrix after Level + Cell"
                  }
                />
              </Field>
              <Field label="Scale of Pay">
                <select value={form.scaleOfPay} onChange={setField("scaleOfPay")}>
                  <option value="">Select</option>
                  <option>14800-47100 (IS-1)</option>
                  <option>15000-47600 (IS-2)</option>
                  <option>15700-50000 (IS-3)</option>
                  <option>18000-56900 (Level-1)</option>
                  <option>19900-63200 (Level-2)</option>
                  <option>21700-69100 (Level-3)</option>
                  <option>25500-81100 (Level-4)</option>
                  <option>29200-92300 (Level-5)</option>
                  <option>35400-112400 (Level-6)</option>
                  <option>39900-126600 (Level-7)</option>
                  <option>44900-142400 (Level-8)</option>
                  <option>53100-167800 (Level-9)</option>
                </select>
              </Field>
              <Field label="Date of Joining" required>
                <input
                  type="date"
                  value={form.dateOfJoining}
                  onChange={setField("dateOfJoining")}
                />
              </Field>
              <Field label="Date of Full Pay">
                <input
                  type="date"
                  value={form.dateOfFullPay}
                  onChange={setField("dateOfFullPay")}
                />
              </Field>
              <Field label="Date of Birth" required>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={setField("dateOfBirth")}
                />
              </Field>
              <Field label="Date of Retirement">
                <input
                  type="date"
                  value={form.dateOfRetirement}
                  onChange={setField("dateOfRetirement")}
                />
              </Field>
              <Field label="Month of Increment">
                <select
                  value={form.monthOfIncrement}
                  onChange={setField("monthOfIncrement")}
                >
                  <option value="">Select Month</option>
                  <option value="1">January</option>
                  <option value="2">February</option>
                  <option value="3">March</option>
                  <option value="4">April</option>
                  <option value="5">May</option>
                  <option value="6">June</option>
                  <option value="7">July</option>
                  <option value="8">August</option>
                  <option value="9">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </select>
              </Field>
              <Field label="GPF/NPS">
                <select value={form.gpfNps} onChange={setField("gpfNps")}>
                  <option value="">Select</option>
                  <option>GPF</option>
                  <option>NPS</option>
                </select>
              </Field>
              <Field label="GPF/NPS Number">
                <input
                  value={form.gpfNpsNumber}
                  onChange={setField("gpfNpsNumber")}
                />
              </Field>
              <Field label="CCC Pass Date">
                <input
                  type="date"
                  value={form.cccPassDate}
                  onChange={setField("cccPassDate")}
                />
              </Field>
              <Field label="Bank Account Number">
                <input
                  inputMode="numeric"
                  value={form.bankAccountNumber}
                  onChange={handleBankChange}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = (e.clipboardData.getData("text") || "").replace(
                      /\D/g,
                      ""
                    );
                    setForm((prev) => ({ ...prev, bankAccountNumber: text }));
                    setBankError(
                      text && !/^\d+$/.test(text)
                        ? "Bank Account Number must contain only numeric characters."
                        : ""
                    );
                  }}
                />
                {bankError ? (
                  <small className="emp-field-error">{bankError}</small>
                ) : null}
              </Field>
              <Field label="Status" required>
                <select value={form.status} onChange={setField("status")}>
                  <option>Active</option>
                  <option>Inactive</option>
                  <option>Retired</option>
                </select>
              </Field>
            </div>
            <div className="hr-actions">
              {message ? <span className="hr-msg">{message}</span> : <span />}
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Saving..." : isEditMode ? "Update" : "Save"}
              </button>
              <button
                type="button"
                className="btn reset"
                onClick={async () => {
                  if (isEditMode) {
                    await prepareNewForm();
                    return;
                  }
                  /* Reset clears fields but keeps the preview Employee ID (no new consumption). */
                  setForm((prev) => ({
                    ...EMPTY,
                    employeeId: prev.employeeId,
                  }));
                  setBankError("");
                  setMessage("");
                }}
              >
                Reset
              </button>
              <button type="button" className="btn" onClick={onBack}>
                Cancel
              </button>
            </div>
          </form>
        </section>

        <section className="hr-card">
          <div className="hr-card-head">
            <span>SEARCH EMPLOYEE</span>
          </div>
          <div className="hr-card-body search-row">
            <label>
              Employee ID
              <input
                value={search.employeeId}
                onChange={(e) =>
                  setSearch((p) => ({ ...p, employeeId: e.target.value }))
                }
              />
            </label>
            <label>
              Employee Name
              <input
                value={search.employeeName}
                onChange={(e) =>
                  setSearch((p) => ({ ...p, employeeName: e.target.value }))
                }
              />
            </label>
            <label>
              Institute
              <input
                value={search.institute}
                onChange={(e) =>
                  setSearch((p) => ({ ...p, institute: e.target.value }))
                }
              />
            </label>
            <label>
              Designation
              <select
                value={search.designation}
                onChange={(e) =>
                  setSearch((p) => ({ ...p, designation: e.target.value }))
                }
              >
                <option value="">All</option>
                {designations.map((row) => (
                  <option
                    key={row.designationId || row.id || row.designationName}
                    value={row.designationName}
                  >
                    {row.designationName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={search.status}
                onChange={(e) =>
                  setSearch((p) => ({ ...p, status: e.target.value }))
                }
              >
                <option value="">All</option>
                <option>Active</option>
                <option>Inactive</option>
                <option>Retired</option>
              </select>
            </label>
            <div className="search-btns">
              <button
                type="button"
                className="btn primary"
                onClick={() => setApplied(search)}
              >
                Search
              </button>
              <button
                type="button"
                className="btn reset"
                onClick={() => {
                  setSearch(EMPTY_SEARCH);
                  setApplied(EMPTY_SEARCH);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <section className="hr-card">
          <div className="hr-card-head">
            <span>EMPLOYEE LIST</span>
          </div>
          <div className="hr-card-body">
            <DataGrid
              title="Employee List"
              rows={filtered}
              emptyText="No employee records found."
              columns={[
                { key: "sr", label: "Sr. No.", type: "serial" },
                { key: "employeeId", label: "Employee ID", align: "center" },
                { key: "employeeName", label: "Employee Name", align: "left" },
                { key: "designation", label: "Designation", align: "left" },
                { key: "employeeType", label: "Employee Type", align: "center" },
                { key: "instituteCode", label: "Institute Code", align: "center" },
                { key: "instituteName", label: "Institute Name", align: "left" },
                { key: "district", label: "District", align: "left" },
                { key: "cityClass", label: "City Class", align: "center" },
                {
                  key: "basicPay",
                  label: "Basic Pay",
                  align: "right",
                  getValue: (row) => moneyDisplay(row.basicPay || 0),
                },
                { key: "dateOfJoining", label: "Date of Joining", type: "date" },
                { key: "dateOfBirth", label: "Date of Birth", type: "date" },
                { key: "gpfNps", label: "GPF/NPS", align: "center" },
                { key: "status", label: "Status", type: "status" },
                {
                  key: "actions",
                  label: "Actions",
                  type: "actions",
                  sortable: false,
                  exportable: false,
                  render: (row) => (
                    <GridActions onEdit={() => loadForEdit(row)} />
                  ),
                },
              ]}
            />
          </div>
        </section>
      </div>
    </ModuleFrame>
  );
}

function Field({ label, required, children }) {
  return (
    <label>
      <span>
        {label}
        {required ? <em> *</em> : null}
      </span>
      {children}
    </label>
  );
}
