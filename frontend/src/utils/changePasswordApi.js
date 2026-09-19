import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

/*
  The host comes from apiConfig (VITE_API_BASE_URL), like every other call in
  the app, so this works against the production API with no hard-coded host.

  The password values are passed straight to fetch and are never logged.
*/
const API_BASE = `${API_BASE_URL}/api/auth`;

export async function changePassword({ currentPassword, newPassword }) {
  const response = await apiFetch(`${API_BASE}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

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
    throw error;
  }
  return data;
}
