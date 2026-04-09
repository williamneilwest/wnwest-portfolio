export function EmptyState({ icon, title, description }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
