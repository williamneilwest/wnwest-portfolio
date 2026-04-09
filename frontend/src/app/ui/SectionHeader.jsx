export function SectionHeader({ tag, title, description, actions }) {
  return (
    <header className="module__header">
      <div className="module__header-copy">
        <span className="module__tag">{tag}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions ? <div className="module__actions">{actions}</div> : null}
    </header>
  );
}
