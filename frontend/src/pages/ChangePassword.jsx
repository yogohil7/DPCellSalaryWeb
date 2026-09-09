import { useState } from "react";
import ModuleFrame from "../components/ModuleFrame";

export default function ChangePassword({ onBack }) {
  const [note, setNote] = useState("");

  return (
    <ModuleFrame title="CHANGE PASSWORD" onBack={onBack}>
      <form
        className="full-form"
        onSubmit={(e) => {
          e.preventDefault();
          setNote("Password change is not connected to the server yet.");
        }}
      >
        <div className="form-grid two">
          <label>Current Password<input type="password" /></label>
          <label>New Password<input type="password" /></label>
          <label>Confirm Password<input type="password" /></label>
        </div>
        <div className="form-actions">
          {note ? <span className="ok">{note}</span> : <span />}
          <button type="submit" className="btn primary">Save</button>
          <button type="button" className="btn" onClick={onBack}>Back</button>
        </div>
      </form>
    </ModuleFrame>
  );
}
