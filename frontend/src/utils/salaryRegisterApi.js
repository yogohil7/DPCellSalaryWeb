import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/salary-register`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      data?.message || `Request failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* One place that turns the current filters into query parameters, so the
   screen request and the Excel export can never disagree about scope. */
function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  const set = (key) => {
    const value = filters[key];
    if (value != null && value !== "") params.set(key, String(value));
  };
  ["month", "year", "billMonth", "billYear", "sectionId", "instituteCode", "salaryType"]
    .forEach(set);
  return params;
}

export async function getSalaryRegisterMeta() {
  return parseResponse(await apiFetch(`${API_BASE}/meta`));
}

export async function getSalaryRegister(filters = {}) {
  return parseResponse(
    await apiFetch(`${API_BASE}?${buildFilterParams(filters).toString()}`)
  );
}

/**
 * Download the Salary Register as a real .xlsx, built by the backend from the
 * SAME report builder the screen uses, so rows, order and totals always agree.
 */
export async function downloadSalaryRegisterExcel(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}/export.xlsx?${buildFilterParams(filters).toString()}`
  );

  if (!response.ok) {
    let message = `Export failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  let fileName = "Salary Register.xlsx";
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match) fileName = match[1];

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* Salary Register drill-down: the exact bill/workflow instance the clicked
   row identifies, never a Salary-Month-only lookup. */
function buildDetailParams({ workflowId, instituteCode, billCodeId } = {}) {
  const params = new URLSearchParams();
  if (workflowId != null && workflowId !== "") {
    params.set("workflowId", String(workflowId));
  }
  if (instituteCode) params.set("instituteCode", String(instituteCode));
  if (billCodeId != null && billCodeId !== "") {
    params.set("billCodeId", String(billCodeId));
  }
  return params;
}

export async function getSalaryRegisterDetail(identity = {}) {
  return parseResponse(
    await apiFetch(`${API_BASE}/detail?${buildDetailParams(identity).toString()}`)
  );
}

/**
 * Download the currently displayed employee detail as a real .xlsx, built by
 * the backend from the SAME builder the detail screen uses.
 */
export async function downloadSalaryRegisterDetailExcel(identity = {}) {
  const response = await apiFetch(
    `${API_BASE}/detail/export.xlsx?${buildDetailParams(identity).toString()}`
  );

  if (!response.ok) {
    let message = `Export failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  let fileName = "Salary Details.xlsx";
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match) fileName = match[1];

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
