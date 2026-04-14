import { Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { searchGroupsCacheFirst } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { cacheGroupLookupResults } from './userGroupsCache';

export function GroupSearchToolPage() {
  const location = useLocation();
  const goBack = useBackNavigation('/app/work');
  const backLabel = location.state?.label || 'Work Hub';
  const [searchText, setSearchText] = useState('');
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupState, setLookupState] = useState({ loading: false, error: '', source: '', updated: 0 });

  async function handleLookup(event, { refresh = false } = {}) {
    event.preventDefault();

    const query = searchText.trim();
    if (!query) {
      setLookupResults([]);
      setLookupState({ loading: false, error: '', source: '', updated: 0 });
      return;
    }

    setLookupState({ loading: true, error: '', source: '', updated: 0 });

    try {
      const result = await searchGroupsCacheFirst(query, { refresh });
      const items = Array.isArray(result.results) ? result.results : [];
      const cacheReadyItems = items.map((group) => ({
        group_id: group.id,
        name: group.name,
        description: group.description,
      }));
      cacheGroupLookupResults(cacheReadyItems);
      setLookupResults(items);
      setLookupState({
        loading: false,
        error: '',
        source: result.source || '',
        updated: Number(result.updated || 0),
      });
    } catch (err) {
      setLookupResults([]);
      setLookupState({
        loading: false,
        error: String(err.message || err),
        source: '',
        updated: 0
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
          <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
            {`Back to ${backLabel}`}
          </button>
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
          <div className="table-actions">
            <span className={lookupState.source === 'cache' ? 'association-status association-status--assigned' : 'association-status association-status--missing'}>
              {lookupState.source === 'cache' ? 'Cached' : 'Live'}
            </span>
            {lookupState.source === 'flow' ? <small>{`Saved ${lookupState.updated} new/updated rows`}</small> : null}
            {lookupState.source === 'cache' && searchText.trim() ? (
              <button
                type="button"
                className="compact-toggle"
                onClick={(event) => void handleLookup(event, { refresh: true })}
              >
                Refresh from Source
              </button>
            ) : null}
          </div>
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
