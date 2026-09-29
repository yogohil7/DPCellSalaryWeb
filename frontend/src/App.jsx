import { useState } from "react";
import "./App.css";
import "./shell.css";
import AppShell from "./components/AppShell";

import {
  clearAuthSession,
  setAuthSession,
} from "./utils/authSession";
import { defaultHomePage, writeHashPage } from "./utils/accessControl";
import { API_BASE_URL } from "./utils/apiConfig";
function App() {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();

    // Clear old message
    setMessage("");

    // Check fields
    if (!userName.trim() || !password) {
      setMessage("Please enter username and password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/login`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            userName: userName.trim(),
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.message || "Invalid username or password."
        );

        return;
      }

      setAuthSession({ token: data.token, user: data.user });

      /*
         Every login starts at the signed-in user's OWN home page.

         The URL hash outlives the session: after a logout, or a browser close
         and reopen, "#/salary-entry" is still sitting in the address bar. The
         AppShell initialises its page from readHashPage() and prefers that
         hash, so without this the stale page was restored and the user landed
         back on whatever they had open before, not on the Dashboard.

         Writing the home hash BEFORE setUser() means the AppShell mounts with
         the home hash already in place and never sees the old one. The target
         comes from defaultHomePage(), the project's canonical role-aware home
         (the Dashboard for every role), so nothing is hard-coded to "home"
         here and no role gets an access-denied notice on the way in.

         This affects the FIRST page after authentication only. Navigation
         during the session is untouched — the AppShell still routes every
         later move through safeNavigate() and its permission check.
      */
      writeHashPage(defaultHomePage(data.user));
      setUser(data.user);
    } catch (error) {
      console.error("Login error:", error);

      setMessage(
        "Unable to connect to server."
      );
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <AppShell
        user={user}
        onLogout={() => {
          clearAuthSession();
          /* Leave no page hash behind for the next login to restore. */
          writeHashPage("home");
          setUser(null);
          setPassword("");
          setMessage("");
        }}
      />
    );
  }

  return (
    <div className="login-page">

      {/* =====================================================
          LEFT SECTION
      ===================================================== */}

      <div className="left-panel">

        {/* -------------------------------------------------
            DP CELL BRAND
        ------------------------------------------------- */}

        <div className="brand">

          {/* ROUND LOGO */}
          <div className="logo-circle">

            <img
              src="/dp-logo.png"
              alt="DP Cell Logo"
              className="brand-logo"
            />

          </div>

          {/* BRAND TEXT */}
          <div className="brand-text">

            <div className="brand-title">
              DP CELL
            </div>

            <div className="brand-subtitle">
              SALARY MANAGEMENT
            </div>

          </div>

        </div>


        {/* -------------------------------------------------
            GUJARATI TEXT
        ------------------------------------------------- */}

        <div className="gujarat-text">

          <div>જય જય</div>

          <div>ગરવી ગુજરાત</div>

        </div>


        {/* -------------------------------------------------
            DECORATIVE LINES
        ------------------------------------------------- */}

        <div className="blue-line"></div>

        <div className="orange-line"></div>

        <div className="green-line"></div>

      </div>


      {/* =====================================================
          RIGHT SECTION
      ===================================================== */}

      <div className="right-panel">

        <div className="login-card">

          {/* -------------------------------------------------
              GOVERNMENT ICON
          ------------------------------------------------- */}

          <div className="government-icon">
            🏛️
          </div>


          {/* -------------------------------------------------
              TITLE
          ------------------------------------------------- */}

          <h1>
            DP Cell Salary Management
          </h1>

          <p className="subtitle">
            Government Salary Verification &amp;
            Management System
          </p>


          {/* -------------------------------------------------
              LOGIN FORM
          ------------------------------------------------- */}

          <form onSubmit={handleLogin}>

            {/* USERNAME */}

            <label htmlFor="username">
              Username
            </label>

            <input
              id="username"
              type="text"
              placeholder="Enter username"
              value={userName}
              onChange={(e) =>
                setUserName(e.target.value)
              }
              autoComplete="username"
            />


            {/* PASSWORD */}

            <label htmlFor="password">
              Password
            </label>

            <div className="password-box">

              <input
                id="password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                placeholder="Enter password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                autoComplete="current-password"
              />


              {/* SHOW / HIDE PASSWORD */}

              <button
                type="button"
                className="eye-button"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                {showPassword ? "◉" : "◌"}
              </button>

            </div>


            {/* FORGOT PASSWORD */}

            <div
              className="forgot-password"
              onClick={() =>
                setMessage(
                  "Please contact the DP Cell administrator to reset your password."
                )
              }
            >
              Forgot Password?
            </div>


            {/* LOGIN BUTTON */}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >
              {loading
                ? "Logging in..."
                : "Login"}
            </button>

          </form>


          {/* -------------------------------------------------
              MESSAGE
          ------------------------------------------------- */}

          {message && (
            <div
              className={
                message.startsWith(
                  "Login successful"
                )
                  ? "message success"
                  : "message error"
              }
            >
              {message}
            </div>
          )}

        </div>

      </div>

    </div>
  );
}

export default App;