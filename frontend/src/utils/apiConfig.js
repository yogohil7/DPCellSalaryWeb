/*
  Central API base URL.

  Every request in the application resolves its host through this module, so
  the deployment target is configuration rather than 35 edited source files.

  Set it in an env file that Vite reads at build time:

    frontend/.env                 VITE_API_BASE_URL=http://localhost:5000
    frontend/.env.production      VITE_API_BASE_URL=https://your-server

  The development default keeps the existing local setup working with no
  action required. No production URL is hard-coded here; a production build
  supplies its own value.

  Route paths are unchanged — callers still append "/api/...", so every
  existing endpoint behaves exactly as before.
*/

const RAW_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  "http://localhost:5000";

/* A trailing slash would produce "//api/..." once joined. */
export const API_BASE_URL = String(RAW_BASE).replace(/\/+$/, "");

/** Join the configured host with an API path. */
export function apiUrl(path = "") {
  const suffix = String(path || "");
  if (!suffix) return API_BASE_URL;
  return `${API_BASE_URL}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
}

export default API_BASE_URL;
