import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { NotificationProvider } from "./components/Notifications.jsx";

import "./App.css";
import "./grid.css";
import "./modern.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* Provides the shared toast API to every screen. Purely additive:
        nothing is rewired here, and screens opt in via useNotifications(). */}
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </StrictMode>
);