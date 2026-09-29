/**
 * Lightweight, dependency-free line icons for the left sidebar.
 *
 * The project has no icon library installed (checked package.json — no
 * lucide-react, no @fortawesome/*, no react-icons, no @mui/icons-material),
 * so rather than add a new dependency this defines a small local icon set
 * (18x18, stroke-based, currentColor) and a per-page-id mapping. If the
 * project ever adopts a real icon library, swap the bodies of ICON_DEFS.
 */

const ICON_DEFS = {
  dashboard: () => (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  layers: () => (
    <>
      <polygon points="12,4 20,8.5 12,13 4,8.5" />
      <polyline points="4,14 12,18.5 20,14" />
    </>
  ),
  building: () => (
    <>
      <rect x="4" y="2" width="10" height="20" rx="1" />
      <rect x="7" y="6" width="2" height="2" />
      <rect x="11" y="6" width="2" height="2" />
      <rect x="7" y="10" width="2" height="2" />
      <rect x="11" y="10" width="2" height="2" />
      <rect x="7" y="14" width="2" height="2" />
      <rect x="11" y="14" width="2" height="2" />
      <rect x="8" y="18" width="4" height="4" />
    </>
  ),
  bank: () => (
    <>
      <polygon points="12,3 21,9 3,9" />
      <line x1="5" y1="9" x2="5" y2="20" />
      <line x1="9.5" y1="9" x2="9.5" y2="20" />
      <line x1="14.5" y1="9" x2="14.5" y2="20" />
      <line x1="19" y1="9" x2="19" y2="20" />
      <line x1="3" y1="21" x2="21" y2="21" />
    </>
  ),
  users: () => (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.3" />
    </>
  ),
  sliders: () => (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" />
    </>
  ),
  badge: () => (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M8.5 12.5 6 21l6-3 6 3-2.5-8.5" />
    </>
  ),
  history: () => (
    <>
      <path d="M3 11a9 9 0 1 1 2.6 6.3" />
      <polyline points="3,5 3,11 9,11" />
      <polyline points="12,7 12,12 16,14" />
    </>
  ),
  table: () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  calculator: () => (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="3" />
      <rect x="7" y="11" width="2.4" height="2.4" />
      <rect x="10.8" y="11" width="2.4" height="2.4" />
      <rect x="14.6" y="11" width="2.4" height="2.4" />
      <rect x="7" y="15" width="2.4" height="2.4" />
      <rect x="10.8" y="15" width="2.4" height="2.4" />
      <rect x="14.6" y="15" width="2.4" height="2.4" />
    </>
  ),
  percent: () => (
    <>
      <line x1="5" y1="19" x2="19" y2="5" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </>
  ),
  trendingUp: () => (
    <>
      <polyline points="3,17 9,11 13,15 21,6" />
      <polyline points="15,6 21,6 21,12" />
    </>
  ),
  house: () => (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v10h12V10" />
      <rect x="10" y="14" width="4" height="6" />
    </>
  ),
  wallet: () => (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="16" cy="13.5" r="1.6" />
    </>
  ),
  heartPulse: () => (
    <>
      <path d="M12 20s-7-4.4-9.5-9C1 7.7 2.4 4.5 5.6 4c2-.3 3.7.7 4.9 2.3L12 8l1.5-1.7C14.7 4.7 16.4 3.7 18.4 4c3.2.5 4.6 3.7 3.1 7-2.5 4.6-9.5 9-9.5 9Z" />
      <polyline points="6,13 9,13 10.5,10 13,16 14.5,13 18,13" />
    </>
  ),
  bus: () => (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <line x1="3" y1="11" x2="21" y2="11" />
      <circle cx="7.5" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </>
  ),
  receipt: () => (
    <>
      <path d="M5 3h14v18l-2.5-1.6L14 21l-2-1.6L10 21l-2.5-1.6L5 21Z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  userCircle: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 18.5c1-2.6 3-4 5.5-4s4.5 1.4 5.5 4" />
    </>
  ),
  shieldUser: () => (
    <>
      <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5Z" />
      <circle cx="12" cy="10" r="2.4" />
      <path d="M8.5 16c.6-2 2-3 3.5-3s2.9 1 3.5 3" />
    </>
  ),
  fileEdit: () => (
    <>
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="M13 3l6 6" />
      <path d="M10 15.5 15 10.5l2 2-5 5H10v-2Z" />
    </>
  ),
  checkCircle: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8,12.5 11,15.5 16,9" />
    </>
  ),
  undo: () => (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  fileCheck: () => (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <polyline points="9,14 11,16.5 15,11.5" />
    </>
  ),
  pieChart: () => (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
      <path d="M14.5 3.4A9 9 0 0 1 20.6 9.5H14.5V3.4Z" />
    </>
  ),
  fileText: () => (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>
  ),
  calendar: () => (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  clipboardList: () => (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="14" x2="16" y2="14" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>
  ),
  minusCircle: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  gitCompare: () => (
    <>
      <path d="M7 3v12a3 3 0 0 0 3 3h6" />
      <polyline points="14,15 17,18 14,21" />
      <path d="M17 21V9a3 3 0 0 0-3-3H8" />
      <polyline points="10,9 7,6 10,3" />
    </>
  ),
  key: () => (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </>
  ),
  logout: () => (
    <>
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="M16 8l4 4-4 4M20 12H9" />
    </>
  ),
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  circle: () => <circle cx="12" cy="12" r="4" />,
};

/** page id (from modules.js) -> icon name (key in ICON_DEFS above). */
export const ICON_MAP = {
  home: "dashboard",

  "section-master": "layers",
  "institute-master": "building",
  "employee-master": "users",
  "payroll-configuration": "sliders",
  "designation-master": "badge",
  "pay-revision-master": "history",
  "pay-matrix": "table",
  "salary-component-master": "calculator",
  "da-master": "percent",
  "increment-master": "trendingUp",
  "hra-master": "house",
  "cla-master": "wallet",
  "medical-allowance": "heartPulse",
  "transport-allowance-master": "bus",
  "salary-bill-code-master": "receipt",
  "user-master": "userCircle",
  "role-permission-master": "shieldUser",

  "salary-entry": "fileEdit",
  "salary-approval": "checkCircle",
  "returning-bills": "undo",
  "final-salary-bill": "fileCheck",

  "da-difference-master": "pieChart",
  "da-difference-entry": "fileEdit",

  "salary-register": "fileText",
  "cheque-register": "receipt",
  "bank-copy": "bank",
  "institute-wise-salary": "building",
  "month-wise-employee-salary": "calendar",
  "employee-wise-salary": "users",
  "employee-pay-slip": "fileText",
  "section-summary": "clipboardList",
  "gpf-summary": "wallet",
  "institute-wise-gpf": "building",
  "nps-summary": "pieChart",
  "nps-institute-wise": "pieChart",
  "nps-deduction": "minusCircle",
  "income-tax-professional-tax": "percent",
  "nps-schedule": "calendar",
  "employee-report": "users",
  "variation-report": "gitCompare",
};

/**
 * Shared renderer behind both SidebarIcon and NavigationIcon below, so the
 * two never duplicate the ICON_DEFS SVG data — they only differ in default
 * size and className. Purely decorative (the adjacent label, or the
 * control's `title`/accessible name, already conveys meaning), so it is
 * always aria-hidden.
 */
function renderIcon(name, { className, size }) {
  const draw = ICON_DEFS[name] || ICON_DEFS.circle;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {draw()}
    </svg>
  );
}

/**
 * Renders one sidebar icon (18px default). Used by the left sidebar's
 * per-page menu items.
 */
export function SidebarIcon({ name, className, size = 18 }) {
  return renderIcon(name, { className, size });
}

/**
 * Renders one top-navigation icon (16px default, per the top nav's
 * slightly smaller icon size than the sidebar). Used by the top
 * navigation's Home / Masters / Salary / DA Difference / Reports items.
 * Reuses the same ICON_DEFS as SidebarIcon rather than a second copy of
 * the SVG paths, under a name that fits the top-nav call sites.
 */
export function NavigationIcon({ name, className, size = 16 }) {
  return renderIcon(name, { className, size });
}
