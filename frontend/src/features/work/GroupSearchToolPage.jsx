import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { lookupReferenceGroups } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

export function GroupSearchToolPage() {
  const [searchText, setSearchText] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupState, setLookupState] = useState({ loading: false, error: '', source: '', cacheHit: false, total: 0 });

  async function handleLookup(event) {
    event.preventDefault();

    const query = searchText.trim();
    if (!query) {
      setLookupResults([]);
      setLookupState({ loading: false, error: '', source: '', cacheHit: false, total: 0 });
      return;
    }

    setLookupState({ loading: true, error: '', source: '', cacheHit: false, total: 0 });

    try {
      const result = await lookupReferenceGroups(query);
      const items = Array.isArray(result.items) ? result.items : [];
      setLookupResults(items);
      setLookupState({
        loading: false,
        error: '',
        source: result.source || '',
        cacheHit: Boolean(result.cacheHit),
        total: Number(result.upserted?.total || 0)
      });
    } catch (err) {
      setLookupResults([]);
      setLookupState({
        loading: false,
        error: String(err.message || err),
        source: '',
        cacheHit: false,
        total: 0
      });
    }
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/work/group-search"
        title="Group Search Tool"
        description="Search cached groups and fall back to the Power Automate lookup when the local reference cache has no match."
        actions={
          <Link className="ui-button ui-button--secondary" to="/app/work">
            Back to Work Hub
          </Link>
        }
      />

      <Card className="reference-card reference-card--wide">
        <CardHeader
          eyebrow="Search"
          title="Group Search"
          description="Checks cached groups first, then falls back to the Power Automate flow and saves new results."
        />

        <form className="settings-form" onSubmit={handleLookup}>
          <label className="settings-field">
            <span>Search text</span>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Enter group name"
            />
          </label>
          <button type="submit" className="ui-button ui-button--primary" disabled={lookupState.loading}>
            {lookupState.loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {lookupState.error ? <p className="status-text status-text--error">{lookupState.error}</p> : null}
        {!lookupState.error && (lookupState.source || lookupResults.length) ? (
          <p className="status-text">
            Source: {lookupState.cacheHit ? 'cache' : lookupState.source || 'unknown'}
            {lookupState.source === 'flow' ? `, saved ${lookupState.total} new or updated rows` : ''}
          </p>
        ) : null}

        {lookupResults.length ? (
          <div className="data-table-wrap reference-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {lookupResults.map((group) => (
                  <tr key={`lookup-${group.id}`}>
                    <td>
                      <span className="data-table__cell-content" title={group.id}>
                        {group.id}
                      </span>
                    </td>
                    <td>
                      <span className="data-table__cell-content" title={group.name}>
                        {group.name || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Search size={20} />}
            title="No search results yet"
            description="Run a group lookup to see cached or flow-backed matches here."
          />
        )}
      </Card>
    </section>
  );
}
