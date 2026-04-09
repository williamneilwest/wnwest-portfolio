export function Card({ children, className = '', tone = 'default' }) {
  const toneClass = tone === 'accent' ? 'ui-card--accent' : tone === 'emerald' ? 'ui-card--emerald' : '';
  const classes = ['ui-card', toneClass, className].filter(Boolean).join(' ');

  return <article className={classes}>{children}</article>;
}

export function CardHeader({ eyebrow, title, description, action }) {
  return (
    <div className="ui-card__header">
      <div>
        {eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}
        {title ? <h3 className="ui-card__title">{title}</h3> : null}
        {description ? <p className="ui-card__description">{description}</p> : null}
      </div>
      {action ? <div className="ui-card__action">{action}</div> : null}
    </div>
  );
}
