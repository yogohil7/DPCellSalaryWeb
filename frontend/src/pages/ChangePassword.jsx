import { useState } from "react";
import ModuleFrame from "../components/ModuleFrame";
import { changePassword } from "../utils/changePasswordApi";

export default function ChangePassword({ onBack }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setNote("");
    setError("");
    if (!currentPassword) {
      setError("Current password is required.");
      return;
    }
    if (!newPassword) {
      setError("New password is required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }
    setSaving(true);
    try {
      const data = await changePassword({ currentPassword, newPassword });
      setNote(data?.message || "Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err?.message || "Unable to change the password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleFrame title="CHANGE PASSWORD" onBack={onBack}>
      <form className="full-form" onSubmit={handleSubmit}>
        <div className="form-grid two">
          <label>Current Password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
          <label>New Password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm Password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
        </div>
        <div className="form-actions">
          {error ? <span style={{ color: "#c62828", fontWeight: 700 }}>{error}</span> : note ? <span className="ok">{note}</span> : <span />}
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          <button type="button" className="btn" onClick={onBack}>Back</button>
        </div>
      </form>
    </ModuleFrame>
  );
}
