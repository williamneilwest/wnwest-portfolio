import { Copy, Database, Network, RefreshCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUserGroups } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

const USER_GROUP_CACHE_KEY = 'work.get-user-groups.cache';

function readCache() {
  try {
    const raw = window.localStorage.getItem(USER_GROUP_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(value) {
  try {
    window.localStorage.setItem(USER_GROUP_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the page usable.
  }
}

function normalizeCachedResult(response) {
  const items = Array.isArray(response?.items)
    ? response.items.map((group) => ({
        id: String(group?.id || '').trim(),
        name: String(group?.name || group?.id || '').trim(),
      })).filter((group) => group.id)
    : [];

  return {
    userOpid: String(response?.userOpid || '').trim(),
    items,
    identifiedCount: Number(response?.identifiedCount || 0),
    totalCount: Number(response?.totalCount || items.length),
    created: Number(response?.created || 0),
    cachedAt: new Date().toISOString(),
    source: String(response?.source || 'flow').trim() || 'flow',
  };
}

function formatTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function copyText(value) {
  if (!value) {
    return false;
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  return false;
}

export function GetUserGroupsPage() {
  const [userOpid, setUserOpid] = useState('');
  const [cache, setCache] = useState({});
  const [selectedOpid, setSelectedOpid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    const nextCache = readCache();
    setCache(nextCache);
    const firstKey = Object.keys(nextCache).sort()[0] || '';
    setSelectedOpid(firstKey);
  }, []);

  const cachedUsers = useMemo(
    () =>
      Object.values(cache)
        .filter((item) => item?.userOpid)
        .sort((left, right) => String(left.userOpid).localeCompare(String(right.userOpid))),
    [cache]
  );

  const result = selectedOpid ? cache[selectedOpid] || null : null;
  const resultJson = useMemo(
    () =>
      result
        ? JSON.stringify(
            {
              userOpid: result.userOpid,
              groups: result.items.map((group) => ({ id: group.id, name: group.name })),
            },
            null,
            2
          )
        : '',
    [result]
  );

  async function loadUserGroups(normalizedOpid, forceRefresh = false) {
    if (!normalizedOpid) {
      setError('Enter a user OPID before running the lookup.');
      return;
    }

    if (!forceRefresh && cache[normalizedOpid]) {
      setSelectedOpid(normalizedOpid);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    setCopyMessage('');

    try {
      const response = await getUserGroups(normalizedOpid);
      const normalized = normalizeCachedResult(response);
      const nextCache = {
        ...cache,
        [normalizedOpid]: normalized,
      };
      setCache(nextCache);
      writeCache(nextCache);
      setSelectedOpid(normalizedOpid);
    } catch (requestError) {
      setError(requestError.message || 'User group lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await loadUserGroups(userOpid.trim(), false);
  }

  async function handleRefresh() {
    await loadUserGroups((selectedOpid || userOpid).trim(), true);
  }

  async function handleCopyJson() {
    const copied = await copyText(resultJson);
    setCopyMessage(copied ? 'JSON copied.' : 'Copy failed.');
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/work/get-user-groups"
        title="Get User Groups"
        description="Calls Get User Groups, resolves cached group names by matching returned ids, and stores each user’s group list as cached JSON until you explicitly refresh it."
        actions={
          <Link className="ui-button ui-button--secondary" to="/app/work">
            Back to Work Hub
          </Link>
        }
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {copyMessage ? <p className="status-text">{copyMessage}</p> : null}

      <div className="card-grid">
        <Card className="landing__card">
          <CardHeader
            eyebrow="Flow Input"
            title="Lookup User Membership"
            description='Uses scriptName "Get User Groups" and caches the resolved name/id group list locally until refreshed.'
          />

          <form className="settings-form" onSubmit={handleSubmit}>
            <label className="settings-field">
              <span>User OPID</span>
              <input
                type="text"
                value={userOpid}
                onChange={(event) => setUserOpid(event.target.value)}
                placeholder="Example: wnwd6f"
              />
            </label>
            <div className="stack-row__actions">
              <button type="submit" className="ui-button ui-button--primary" disabled={loading}>
                {loading ? 'Loading…' : 'Get User Groups'}
              </button>
              <button
                type="button"
                className="compact-toggle"
                onClick={() => void handleRefresh()}
                disabled={loading || (!selectedOpid && !userOpid.trim())}
              >
                <RefreshCcw size={14} />
                Refresh
              </button>
            </div>
          </form>
        </Card>

        <Card className="landing__card">
          <CardHeader
            eyebrow="Summary"
            title="Selected User"
            description="The full group list is cached as JSON per user, but only the summary stays visible here."
            action={
              <span className="icon-badge">
                <Network size={16} />
              </span>
            }
          />

          {result ? (
            <div className="association-summary">
              <div className="association-summary__row">
                <span>User OPID</span>
                <strong>{result.userOpid}</strong>
              </div>
              <div className="association-summary__row">
                <span>Resolved Groups</span>
                <strong>{result.totalCount}</strong>
              </div>
              <div className="association-summary__row">
                <span>Identified Names</span>
                <strong>{result.identifiedCount}</strong>
              </div>
              <div className="association-summary__row">
                <span>Cached At</span>
                <strong>{formatTimestamp(result.cachedAt)}</strong>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Search size={20} />}
              title="No lookup selected"
              description="Run a lookup or choose a cached user to view the stored summary."
            />
          )}
        </Card>

        <Card className="landing__card">
          <CardHeader
            eyebrow="Cache"
            title="Cached Users"
            description="Each user keeps a stored JSON group list until you refresh that specific lookup."
            action={
              <span className="icon-badge">
                <Database size={16} />
              </span>
            }
          />

          {cachedUsers.length ? (
            <div className="stack-list">
              {cachedUsers.map((item) => (
                <button
                  key={item.userOpid}
                  type="button"
                  className="stack-row stack-row--interactive"
                  onClick={() => setSelectedOpid(item.userOpid)}
                >
                  <span className="stack-row__label">
                    <span>
                      <strong>{item.userOpid}</strong>
                      <small>{item.totalCount} groups · {formatTimestamp(item.cachedAt)}</small>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Database size={20} />}
              title="No cached users yet"
              description="User group lookups will stay stored here after the first successful run."
            />
          )}
        </Card>
      </div>

      <Card className="reference-card reference-card--wide">
        <CardHeader
          eyebrow="Stored JSON"
          title="User Group Payload"
          description="Saved JSON contains only name/id pairs for the selected user’s resolved group list."
          action={
            <button
              type="button"
              className="compact-toggle"
              onClick={() => void handleCopyJson()}
              disabled={!resultJson}
            >
              <Copy size={14} />
              Copy JSON
            </button>
          }
        />

        {resultJson ? (
          <details className="upload-row-menu" open>
            <summary className="compact-toggle upload-row-menu__toggle">View Stored JSON</summary>
            <div className="textarea-field">
              <textarea className="association-script association-script--fit" readOnly value={resultJson} />
            </div>
          </details>
        ) : (
          <EmptyState
            icon={<Search size={20} />}
            title="No JSON stored yet"
            description="The selected user’s cached JSON payload will appear here after a successful lookup."
          />
        )}
      </Card>
    </section>
  );
}
