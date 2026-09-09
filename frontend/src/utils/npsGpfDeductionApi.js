import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/nps-gpf-deduction`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* One place that turns the filters into query parameters, so the screen
   request and the Excel export can never disagree about scope. */
function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.sectionId != null && filters.sectionId !== "") {
    params.set("sectionId", String(filters.sectionId));
  }
  if (filters.instituteCode != null && filters.instituteCode !== "") {
    params.set("instituteCode", String(filters.instituteCode));
  }
  if (filters.employeeId != null && filters.employeeId !== "") {
    params.set("employeeId", String(filters.employeeId));
  }
  if (filters.allMonths) {
    params.set("allMonths", "1");
  } else {
    if (filters.fromMonth != null && filters.fromMonth !== "") {
      params.set("fromMonth", String(filters.fromMonth));
    }
    if (filters.fromYear != null && filters.fromYear !== "") {
      params.set("fromYear", String(filters.fromYear));
    }
    if (filters.toMonth != null && filters.toMonth !== "") {
      params.set("toMonth", String(filters.toMonth));
    }
    if (filters.toYear != null && filters.toYear !== "") {
      params.set("toYear", String(filters.toYear));
    }
  }
  if (filters.salaryType != null && filters.salaryType !== "") {
    params.set("salaryType", String(filters.salaryType));
  }
  if (filters.salaryCategory != null && filters.salaryCategory !== "") {
    params.set("salaryCategory", String(filters.salaryCategory));
  }
  if (filters.deductionType != null && filters.deductionType !== "") {
    params.set("deductionType", String(filters.deductionType));
  }
  return params;
}

export async function getNpsGpfDeduction(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}

export async function downloadNpsGpfDeductionExcel(filters = {}) {
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

  let fileName = "NPS GPF Deduction Report.xlsx";
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
