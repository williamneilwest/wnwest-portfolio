import { Clipboard, Network, Search, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getReferenceGroups,
  getReferenceUsers,
  lookupReferenceGroupsFromFlow,
} from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

const SEARCH_HISTORY_KEY = 'work.user-group-association.search-history';
const CLICK_HISTORY_KEY = 'work.user-group-association.group-clicks';
const MAX_SEARCH_TERMS = 8;
const MAX_CLICKED_GROUPS = 24;

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function readStoredObject(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredObject(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the page usable.
  }
}

function rankEntries(record, limit) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function updateCounter(record, key, limit) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return record;
  }

  const next = { ...record, [normalizedKey]: Number(record[normalizedKey] || 0) + 1 };
  const trimmed = rankEntries(next, limit);
  return Object.fromEntries(trimmed);
}

function buildAssociationScript(user, groups) {
  if (!user || !groups.length) {
    return '';
  }

  const groupLines = groups
    .map((group) => `    @{ id = "${group.id}"; name = "${group.name || group.id}" }`)
    .join(',\n');

  return [
    '$associationRequest = @{',
    '  user = @{',
    `    id = "${user.id}"`,
    `    name = "${user.name || user.id}"`,
    `    email = "${user.email || ''}"`,
    '  }',
    '  groups = @(',
    groupLines,
    '  )',
    '}',
    '',
    'foreach ($group in $associationRequest.groups) {',
    '  Write-Host ("Associate {0} with {1} ({2})" -f $associationRequest.user.id, $group.name, $group.id)',
    '  # Invoke your directory or automation step here.',
    '}',
  ].join('\n');
}

async function copyText(value) {
  if (!value) {
    return false;
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'absolute';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  const didCopy = document.execCommand('copy');
  document.body.removeChild(textArea);
  return didCopy;
}

function groupMatchScore(group, query) {
  if (!query) {
    return 0;
  }

  const id = normalizeSearch(group.id);
  const name = normalizeSearch(group.name);

  if (name.startsWith(query) || id.startsWith(query)) {
    return 3;
  }
  if (name.includes(query) || id.includes(query)) {
    return 2;
  }
  return 0;
}

export function UserGroupAssociationPage() {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [flowLoading, setFlowLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [flowMessage, setFlowMessage] = useState('');
  const [searchHistory, setSearchHistory] = useState({});
  const [clickedGroups, setClickedGroups] = useState({});

  useEffect(() => {
    setSearchHistory(readStoredObject(SEARCH_HISTORY_KEY));
    setClickedGroups(readStoredObject(CLICK_HISTORY_KEY));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadReferenceData() {
      setLoading(true);
      setError('');

      try {
        const [usersResult, groupsResult] = await Promise.all([getReferenceUsers(), getReferenceGroups()]);

        if (!isMounted) {
          return;
        }

        const nextUsers = Array.isArray(usersResult) ? usersResult : [];
        const nextGroups = Array.isArray(groupsResult) ? groupsResult : [];
        setUsers(nextUsers);
        setGroups(nextGroups);
        setSelectedUserId((current) => current || nextUsers[0]?.id || '');
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || 'Reference data could not be loaded.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, []);

  const topSearchTerms = useMemo(
    () => rankEntries(searchHistory, 5).map(([term]) => term),
    [searchHistory]
  );

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [selectedUserId, users]
  );

  const selectedGroups = useMemo(() => {
    const selectedIds = new Set(selectedGroupIds);
    return groups.filter((group) => selectedIds.has(group.id));
  }, [groups, selectedGroupIds]);

  const filteredUsers = useMemo(() => {
    const query = normalizeSearch(userQuery);
    const items = query
      ? users.filter((user) =>
          [user.id, user.name, user.email].some((value) => normalizeSearch(value).includes(query))
        )
      : users;
    return items.slice(0, 12);
  }, [userQuery, users]);

  const filteredGroups = useMemo(() => {
    const query = normalizeSearch(groupQuery);
    const selectedIds = new Set(selectedGroupIds);

    const matches = groups
      .filter((group) => {
        if (!query) {
          return true;
        }
        return [group.id, group.name].some((value) => normalizeSearch(value).includes(query));
      })
      .sort((left, right) => {
        const leftSelected = selectedIds.has(left.id) ? 1 : 0;
        const rightSelected = selectedIds.has(right.id) ? 1 : 0;
        if (leftSelected !== rightSelected) {
          return rightSelected - leftSelected;
        }

        const leftClicks = Number(clickedGroups[left.id] || 0);
        const rightClicks = Number(clickedGroups[right.id] || 0);
        if (leftClicks !== rightClicks) {
          return rightClicks - leftClicks;
        }

        const leftScore = groupMatchScore(left, query);
        const rightScore = groupMatchScore(right, query);
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }

        return String(left.name || left.id).localeCompare(String(right.name || right.id));
      });

    return matches.slice(0, 24);
  }, [clickedGroups, groupQuery, groups, selectedGroupIds]);

  const generatedScript = useMemo(
    () => buildAssociationScript(selectedUser, selectedGroups),
    [selectedGroups, selectedUser]
  );

  function rememberSearchTerm(term) {
    const normalizedTerm = String(term || '').trim();
    if (!normalizedTerm) {
      return;
    }

    setSearchHistory((current) => {
      const next = updateCounter(current, normalizedTerm, MAX_SEARCH_TERMS);
      writeStoredObject(SEARCH_HISTORY_KEY, next);
      return next;
    });
  }

  function rememberGroupClick(groupId) {
    setClickedGroups((current) => {
      const next = updateCounter(current, groupId, MAX_CLICKED_GROUPS);
      writeStoredObject(CLICK_HISTORY_KEY, next);
      return next;
    });
  }

  function toggleGroup(groupId) {
    rememberGroupClick(groupId);
    setSelectedGroupIds((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
    );
  }

  async function handleCopyScript() {
    try {
      const didCopy = await copyText(generatedScript);
      setCopyMessage(didCopy ? 'Script copied.' : 'Copy failed in this browser.');
    } catch {
      setCopyMessage('Copy failed in this browser.');
    }
  }

  async function handleFlowLookup() {
    const query = groupQuery.trim();
    if (!query) {
      setFlowMessage('Enter a group search term before calling Power Automate.');
      return;
    }

    setFlowLoading(true);
    setError('');
    setFlowMessage('');

    try {
      const result = await lookupReferenceGroupsFromFlow(query);
      const items = Array.isArray(result.items) ? result.items : [];

      setGroups((current) => {
        const merged = new Map(current.map((group) => [group.id, group]));
        items.forEach((group) => {
          if (group?.id) {
            merged.set(group.id, group);
          }
        });
        return Array.from(merged.values());
      });

      rememberSearchTerm(query);
      setFlowMessage(
        items.length
          ? `Power Automate returned ${items.length} group${items.length === 1 ? '' : 's'} and cached them locally.`
          : 'Power Automate completed but returned no groups for that search.'
      );
    } catch (requestError) {
      setError(requestError.message || 'Power Automate search failed.');
    } finally {
      setFlowLoading(false);
    }
  }

  if (loading) {
    return (
      <section className="module">
        <SectionHeader
          tag="/app/work/user-group-association"
          title="User-Group Association"
          description="Reference-driven workspace for building group association scripts."
          actions={
            <Link className="ui-button ui-button--secondary" to="/app/work">
              Back to Work Hub
            </Link>
          }
        />
        <EmptyState
          icon={<UsersRound size={20} />}
          title="Loading reference data"
          description={error || 'Fetching cached users and groups for the association workspace.'}
        />
      </section>
    );
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/work/user-group-association"
        title="User-Group Association"
        description="Select a cached user, target the right reference groups, and generate a reusable association script without leaving the Work module."
        actions={
          <Link className="ui-button ui-button--secondary" to="/app/work">
            Back to Work Hub
          </Link>
        }
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {copyMessage ? <p className="status-text">{copyMessage}</p> : null}
      {flowMessage ? <p className="status-text">{flowMessage}</p> : null}

      <div className="work-layout association-layout">
        <div className="card-grid association-column">
          <Card className="landing__card association-card">
            <CardHeader
              eyebrow="Step 1"
              title="Select User"
              description="Search the cached reference users and choose the identity the association run should target."
            />

            <div className="settings-form">
              <label className="settings-field">
                <span>User search</span>
                <input
                  type="text"
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Search by id, name, or email"
                />
              </label>
            </div>

            <div className="association-list" role="list" aria-label="Reference users">
              {filteredUsers.length ? (
                filteredUsers.map((user) => {
                  const isSelected = user.id === selectedUserId;
                  return (
                    <button
                      type="button"
                      key={user.id}
                      className={isSelected ? 'association-list__item association-list__item--selected' : 'association-list__item'}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <span className="association-list__title">{user.name || user.id}</span>
                      <span className="association-list__meta">{user.email || user.id}</span>
                    </button>
                  );
                })
              ) : (
                <EmptyState
                  icon={<Search size={18} />}
                  title="No matching users"
                  description="Adjust the search or load additional users into the reference cache first."
                />
              )}
            </div>
          </Card>

          <Card className="landing__card association-card">
            <CardHeader
              eyebrow="Step 2"
              title="Select Groups"
              description="Filter cached groups locally, or manually call Power Automate to fetch and cache new results."
            />

            <div className="settings-form">
              <label className="settings-field">
                <span>Group search</span>
                <input
                  type="text"
                  value={groupQuery}
                  onChange={(event) => setGroupQuery(event.target.value)}
                  placeholder="Search by group id or name"
                />
              </label>

              <div className="association-toolbar">
                <button
                  type="button"
                  className="ui-button ui-button--primary"
                  onClick={handleFlowLookup}
                  disabled={flowLoading}
                >
                  <Sparkles size={16} />
                  {flowLoading ? 'Searching Power Automate...' : 'Search Power Automate'}
                </button>
              </div>

              {topSearchTerms.length ? (
                <div className="association-history">
                  <span className="association-history__label">Common searches</span>
                  <div className="association-chip-list association-chip-list--history">
                    {topSearchTerms.map((term) => (
                      <button
                        type="button"
                        key={term}
                        className="association-chip association-chip--button"
                        onClick={() => setGroupQuery(term)}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="association-list association-list--fit" role="list" aria-label="Reference groups">
              {filteredGroups.length ? (
                filteredGroups.map((group) => {
                  const isSelected = selectedGroupIds.includes(group.id);
                  const clickCount = Number(clickedGroups[group.id] || 0);
                  return (
                    <button
                      type="button"
                      key={group.id}
                      className={isSelected ? 'association-list__item association-list__item--selected' : 'association-list__item'}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <span className="association-list__title">{group.name || group.id}</span>
                      <span className="association-list__meta">
                        {group.id}
                        {clickCount ? ` · opened ${clickCount}x` : ''}
                      </span>
                    </button>
                  );
                })
              ) : (
                <EmptyState
                  icon={<Search size={18} />}
                  title="No matching groups"
                  description="Adjust the search or use the Power Automate button to fetch additional groups."
                />
              )}
            </div>
          </Card>
        </div>

        <div className="card-grid card-grid--compact association-column">
          <Card className="landing__card association-card">
            <CardHeader
              eyebrow="Selection"
              title="Association Summary"
              description="Review the current user and target groups before copying the generated script."
              action={
                <span className="icon-badge">
                  <Network size={16} />
                </span>
              }
            />

            <div className="association-summary">
              <div className="association-summary__row">
                <span>User</span>
                <strong>{selectedUser ? selectedUser.name || selectedUser.id : 'Select a user'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Email</span>
                <strong>{selectedUser?.email || 'No email in cache'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Groups</span>
                <strong>{selectedGroups.length}</strong>
              </div>
            </div>

            <div className="association-chip-list">
              {selectedGroups.length ? (
                selectedGroups.map((group) => (
                  <span className="association-chip" key={group.id}>
                    {group.name || group.id}
                  </span>
                ))
              ) : (
                <p className="ui-card__description">No groups selected yet.</p>
              )}
            </div>
          </Card>

          <Card className="landing__card association-card">
            <CardHeader
              eyebrow="Output"
              title="Generated Script"
              description="The script uses the selected reference records and stays within the page viewport instead of stretching the layout."
              action={
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  onClick={handleCopyScript}
                  disabled={!generatedScript}
                >
                  <Clipboard size={16} />
                  Copy
                </button>
              }
            />

            <div className="textarea-field">
              <textarea
                className="association-script association-script--fit"
                readOnly
                value={
                  generatedScript ||
                  '# Select one user and at least one group to generate the association script.'
                }
              />
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
