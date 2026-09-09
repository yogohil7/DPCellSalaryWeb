import { useEffect, useState } from "react";
import { canAccessPage } from "../utils/accessControl";
import { getDashboardSummary } from "../utils/dashboardApi";

/* Loading placeholder — never a fake value. */
const LOADING = "—";

function formatPlain(value) {
  return String(Number(value) || 0);
}

function formatGrouped(value) {
  return (Number(value) || 0).toLocaleString("en-IN");
}

function formatPadded(value) {
  return String(Number(value) || 0).padStart(2, "0");
}

const TOP_CARDS = [
  {
    id: "salary-process",
    title: "Salary Bills",
    metric: "salaryBills",
    format: formatPlain,
    note: "Current month bills",
    action: "Process",
    icon: "♙", tone: "lilac",
  },
  {
    id: "employee-master",
    title: "Employees",
    metric: "employees",
    format: formatGrouped,
    note: "Active on payroll",
    action: "View",
    icon: "⌂", tone: "peach",
  },
  {
    id: "salary-approval",
    title: "Pending Approval",
    metric: "pendingApproval",
    format: formatPadded,
    note: "Bills awaiting action",
    action: "Open",
    icon: "✓", tone: "blue",
  },
];

const TASKS = [
  { id: "salary-entry", label: "Salary Entry", metric: "salaryEntry", format: formatPadded, note: "Draft bills ready", icon: "▤", tone: "violet" },
  { id: "salary-process", label: "Verification", metric: "verification", format: formatPadded, note: "Awaiting review", icon: "⇄", tone: "cream" },
  { id: "salary-approval", label: "Approval Details", metric: "approvalDetails", format: formatPadded, note: "Pending approval", icon: "☷", tone: "mint" },
  { id: "returning-bills", label: "Returned Bills", metric: "returnedBills", format: formatPadded, note: "Auditor action", icon: "↶", tone: "lilac" },
  { id: "variation-report", label: "Variation Report", metric: "variationReport", format: formatPadded, note: "Salary variations", icon: "▥", tone: "sky" },
  { id: "final-salary-bill", label: "Final Salary Bill", metric: "finalSalaryBill", format: formatPlain, note: "Bills processed", icon: "▣", tone: "sage" },
];

export default function Dashboard({ user, onNavigate }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getDashboardSummary()
      .then((res) => {
        if (!active) return;
        setMetrics(res?.data?.metrics || null);
        if (!res?.data?.metrics) {
          setError("Unable to load dashboard data.");
        }
      })
      .catch(() => {
        if (active) {
          setMetrics(null);
          setError("Unable to load dashboard data.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const valueOf = (card) => {
    if (loading || error || !metrics) return LOADING;
    const raw = metrics[card.metric];
    if (raw == null) return LOADING;
    return card.format(raw);
  };

  const topCards = TOP_CARDS.filter((card) => canAccessPage(user, card.id));
  const tasks = TASKS.filter((task) => canAccessPage(user, task.id));

  return (
    <div className="dash-content">
      <div className="dash-heading"><span>⌾</span><h1>Dashboard</h1></div>
      {error && !loading ? (
        <div className="dash-error" role="alert">
          <span>Unable to load dashboard data.</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="top-cards">
        {topCards.map((card) => (
          <article key={card.title} className={`color-card ${card.tone}`}>
            <div className="color-icon">{card.icon}</div>
            <div className="color-info">
              <div className="color-title">{card.title}</div>
              <div className="color-value">{valueOf(card)}</div>
              <div className="color-note">{card.note}</div>
              <button type="button" onClick={() => onNavigate(card.id)}>
                {card.action}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="pending-wrap">
        <h3>Payroll Activity</h3>
        <div className="task-grid">
          {tasks.map((task) => (
            <button
              key={task.label}
              type="button"
              className={`task-tile ${task.tone}`}
              onClick={() => onNavigate(task.id)}
            >
              <div className="task-icon">{task.icon}</div>
              <div><span>{task.label}</span><strong>{valueOf(task)}</strong><small>{task.note}</small></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
