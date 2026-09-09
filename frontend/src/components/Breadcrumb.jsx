import { getStoredUser } from "../utils/authSession";
import { defaultHomePage, writeHashPage } from "../utils/accessControl";

/**
 * Shared breadcrumb: Home / <section> / <current page>.
 *
 * "Home" navigates to the signed-in user's OWN home page rather than to the
 * literal "home" id. That distinction matters: canAccessPage() denies "home"
 * to an Account Officer, whose landing page is Salary Approval. Hard-coding
 * "home" therefore made a legitimate Home click raise "Access denied to
 * HOME. Redirected to an allowed page." before landing them in the right
 * place — a false alarm on a valid action.
 *
 * Resolving through defaultHomePage() sends every role straight to its own
 * home with no notice. Access control is unchanged: navigation still goes
 * through the hash, which AppShell's hashchange handler routes through
 * safeNavigate() and its permission check, exactly as before.
 *
 * writeHashPage() is the app's existing hash helper, so the canonical hash is
 * written once ("#/" for home) instead of a second, non-canonical "#/home"
 * that AppShell would immediately rewrite.
 */
export default function Breadcrumb({ className, section, current, user }) {
  const goHome = () => {
    /* The user prop wins when a page supplies one; otherwise the stored
       session user, so the 16 existing call sites need no change. */
    const actor = user || getStoredUser();
    writeHashPage(defaultHomePage(actor));
  };

  return (
    <span className={className}>
      <button type="button" className="app-breadcrumb-home" onClick={goHome}>
        Home
      </button>
      {section ? ` / ${section}` : ""} / {current}
    </span>
  );
}
