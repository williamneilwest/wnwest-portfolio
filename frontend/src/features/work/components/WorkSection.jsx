export function WorkSection({ title, description, children, compact = false, prominent = false }) {
  const className = [
    'work-hub-domain-section',
    compact ? 'work-hub-domain-section--compact' : '',
    prominent ? 'work-hub-domain-section--core' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className}>
      <header className="work-hub-domain-section__header">
        <div>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </div>
      </header>
      <div className="work-hub-domain-section__body">{children}</div>
    </section>
  );
}
