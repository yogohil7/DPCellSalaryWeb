/*
  Central API base URL.

  Every request in the application resolves its host through this module, so
  the deployment target is configuration rather than 35 edited source files.

  SAME-ORIGIN DEPLOYMENT (production)
    In production the API base is an EMPTY string, so every caller's
    `${API_BASE_URL}/api/...` resolves to a RELATIVE url:

        /api/auth/login        not   http://<server-ip>:5000/api/auth/login

    The browser therefore sends API calls to whatever origin served the page,
    and IIS reverse-proxies /api/* to the Node backend on 127.0.0.1:5000
    (see frontend/web.config). No LAN IP or hostname is compiled into the
    bundle, so a change of server address never requires a rebuild.

  DEVELOPMENT
    Vite's dev server runs on a different port from the API, so development
    still needs an absolute host. frontend/.env supplies it
    (VITE_API_BASE_URL=http://localhost:5000); if that file is absent, the
    dev fallback below keeps `npm run dev` working with no setup.

  OVERRIDE
    VITE_API_BASE_URL still wins whenever it is set to a non-empty value, so
    a separately hosted frontend can still point at an absolute API host.
    Setting it to an EMPTY value explicitly selects same-origin. Note the
    `!= null` test rather than `||`: an empty string is a meaningful value
    here (same-origin) and must not fall through to the dev default.
*/

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

/* Absolute host used by `npm run dev` when no env file is present. */
const DEV_FALLBACK = "http://localhost:5000";

const configured = ENV.VITE_API_BASE_URL;

const RAW_BASE =
  configured != null
    ? configured
    : ENV.DEV
    ? DEV_FALLBACK
    : ""; /* production default: same origin */

/* A trailing slash would produce "//api/..." once joined. "/" becomes "". */
export const API_BASE_URL = String(RAW_BASE).replace(/\/+$/, "");

/** Join the configured host with an API path. */
export function apiUrl(path = "") {
  const suffix = String(path || "");
  if (!suffix) return API_BASE_URL;
  return `${API_BASE_URL}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
}

export default API_BASE_URL;
