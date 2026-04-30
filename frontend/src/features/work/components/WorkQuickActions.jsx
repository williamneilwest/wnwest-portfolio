import { Search } from 'lucide-react';

export function WorkQuickActions({ searchValue, onSearchChange }) {
  return (
    <section className="work-hub-search-panel" aria-label="Work search">
      <label className="work-hub-search" htmlFor="work-hub-search">
        <span className="work-hub-search__icon" aria-hidden="true">
          <Search size={17} />
        </span>
        <span className="work-hub-search__copy">
          <strong>Search</strong>
          <small>Search user, ticket, or device</small>
        </span>
        <span className="sr-only">Search work tools</span>
        <div className="work-hub-search__field">
          <input
            id="work-hub-search"
            className="work-hub-search__input"
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search user, ticket, or device..."
          />
        </div>
      </label>
    </section>
  );
}
