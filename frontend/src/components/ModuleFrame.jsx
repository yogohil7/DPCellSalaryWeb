export default function ModuleFrame({ title, onBack, children }) {
  return (
    <div className="module-page">
      <button type="button" className="back-home" onClick={onBack}>
        ← Back to Home
      </button>
      <h1>{title}</h1>
      <div className="module-body">{children}</div>
    </div>
  );
}
