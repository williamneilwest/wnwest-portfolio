import { Link } from 'react-router-dom';

export function WorkQuickActions({ actions, onOpen, searchValue, onSearchChange }) {
  return (
    <section className="work-hub-section work-hub-section--compact">
      <header className="work-hub-section__header">
        <div>
          <strong>Quick Actions</strong>
          <small>Start with the most common work tasks, then move into the deeper modules below.</small>
        </div>
      </header>

      <div className="work-hub-section__body">
        <label className="work-hub-search" htmlFor="work-hub-search">
          <span className="sr-only">Search work tools</span>
          <input
            id="work-hub-search"
            className="work-hub-search__input"
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search user, ticket, or device..."
          />
        </label>

        <div className="work-quick-actions-bar" role="group" aria-label="Primary work actions">
          {actions.map((action) => (
            <Link
              key={action.label}
              className={`work-quick-action-pill${action.primary ? ' work-quick-action-pill--primary' : ''}`}
              to={action.href}
              onClick={() => onOpen({ title: action.label, href: action.href })}
              state={{ from: '/app/work', label: 'Work Hub' }}
            >
              <span className="work-quick-action-pill__leading" aria-hidden="true">
                <action.icon size={15} />
              </span>
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
