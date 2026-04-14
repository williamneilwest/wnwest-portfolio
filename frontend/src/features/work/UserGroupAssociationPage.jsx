import { Clipboard, Network, Search, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import {
  getReferenceGroups,
  getUserGroups,
  lookupReferenceGroupsFromFlow,
} from '../../app/services/api';
import { STORAGE_KEYS, STORAGE_TTLS } from '../../app/constants/storageKeys';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { storage } from '../../app/utils/storage';
import {
  getCachedUsersFromMap,
  getCachedGroupsForUser,
  getCachedUsersWithDiagnostics,
  normalizeFlowMembershipResponse,
  readUserGroupsCacheMap,
  upsertCachedUserRecord,
  writeUserGroupsCacheMap,
} from './userGroupsCache';

const SEARCH_HISTORY_KEY = STORAGE_KEYS.GROUP_SEARCH_HISTORY;
const CLICK_HISTORY_KEY = STORAGE_KEYS.GROUP_CLICKS;
const MAX_SEARCH_TERMS = 8;
const MAX_CLICKED_GROUPS = 24;

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidGroupId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!id) {
    return false;
  }
  if (id.includes('$metadata')) {
    return false;
  }
  if (id.startsWith('https://graph.microsoft.com')) {
    return false;
  }
  return true;
}

function readStoredObject(key) {
  const parsed = storage.getWithTTL(key);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeStoredObject(key, value) {
  const ttlMs = key === SEARCH_HISTORY_KEY ? STORAGE_TTLS.GROUP_SEARCH_HISTORY : STORAGE_TTLS.GROUP_CLICKS;
  storage.setWithTTL(key, value, ttlMs);
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
  if (!user) {
    return '';
  }

  if (!groups.length) {
    return '# Select at least one group to validate membership.';
  }

  if (groups.every((group) => group.existsInUser)) {
    return '✅ User already has all selected groups. No action needed.';
  }

  const missingGroups = groups.filter((group) => !group.existsInUser);
  const userId = user.id || user.opid || '';

  return [
    `# Add missing groups for ${userId}`,
    '',
    ...missingGroups.map((group) => `Add-UserToGroup -UserId "${userId}" -GroupId "${group.id}"`),
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

export function UserGroupAssociationPage({
  embedded = false,
  selectedUser = null,
  userContext = null,
  onUserCacheUpdated = null,
}) {
  const location = useLocation();
  const goBack = useBackNavigation('/app/work');
  const backLabel = location.state?.label || 'Work Hub';
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [flowLoading, setFlowLoading] = useState(false);
  const [userFlowLoading, setUserFlowLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [flowMessage, setFlowMessage] = useState('');
  const [searchHistory, setSearchHistory] = useState({});
  const [clickedGroups, setClickedGroups] = useState({});
  const [cacheUsersLoaded, setCacheUsersLoaded] = useState(0);

  function debugLog(message, payload = {}) {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.DEV) {
      console.info(`[UserGroupAssociation] ${message}`, payload);
    }
  }

  function mergeGroups(baseGroups = [], additionalGroups = []) {
    const merged = new Map();
    [...baseGroups, ...additionalGroups].forEach((group) => {
      const id = String(group?.id || '').trim();
      if (!isValidGroupId(id)) {
        return;
      }
      const providedName = String(group?.name || '').trim();
      merged.set(id, {
        id,
        name: providedName || id,
        unresolved: !providedName,
      });
    });
    return Array.from(merged.values());
  }

  useEffect(() => {
    setSearchHistory(readStoredObject(SEARCH_HISTORY_KEY));
    setClickedGroups(readStoredObject(CLICK_HISTORY_KEY));
  }, []);

  useEffect(() => {
    if (!embedded) {
      return;
    }
    setSelectedUserId(String(selectedUser?.opid || '').trim());
  }, [embedded, selectedUser]);

  useEffect(() => {
    let isMounted = true;

    async function loadReferenceData() {
      setLoading(true);
      setError('');

      try {
        const cacheMap = readUserGroupsCacheMap();
        const { users: cachedUsers, fallbackCount } = getCachedUsersWithDiagnostics(cacheMap);
        const cachedGroups = cachedUsers.flatMap((user) => user.groups || []);

        if (!isMounted) {
          return;
        }

        setUsers(cachedUsers);
        setCacheUsersLoaded(cachedUsers.length);
        setGroups(mergeGroups([], cachedGroups));
        if (!embedded) {
          setSelectedUserId((current) => current || cachedUsers[0]?.opid || '');
        }
        debugLog('Loaded cached users', {
          loadedCount: cachedUsers.length,
          fallbackCount,
        });

        setLoading(false);

        try {
          const groupsResult = await getReferenceGroups();
          if (!isMounted) {
            return;
          }
          const referenceGroups = Array.isArray(groupsResult) ? groupsResult : [];
          setGroups((current) => mergeGroups(current, referenceGroups));
        } catch {
          // Cache-first UX: keep page usable even if reference groups endpoint is unavailable.
        }
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

  const effectiveSelectedUserId = embedded
    ? String(selectedUser?.opid || '').trim()
    : selectedUserId;

  useEffect(() => {
    if (!effectiveSelectedUserId) {
      setSelectedGroupIds([]);
      return;
    }

    const cacheMap = readUserGroupsCacheMap();
    const cachedGroupIds = getCachedGroupsForUser(effectiveSelectedUserId, cacheMap).map((group) => group.id);
    const selectedSet = new Set(cachedGroupIds);
    setSelectedGroupIds([]);
    setGroups((current) => mergeGroups(current, getCachedGroupsForUser(effectiveSelectedUserId, cacheMap)));
    debugLog('Selected user hydrated from cache', {
      opid: effectiveSelectedUserId,
      groupsCount: selectedSet.size,
      preselectedCount: 0,
    });
  }, [effectiveSelectedUserId]);

  const topSearchTerms = useMemo(
    () => rankEntries(searchHistory, 5).map(([term]) => term),
    [searchHistory]
  );

  const effectiveSelectedUser = useMemo(() => {
    if (embedded) {
      return selectedUser || null;
    }
    return users.find((user) => user.opid === selectedUserId) || null;
  }, [embedded, selectedUser, selectedUserId, users]);

  const selectedGroups = useMemo(() => {
    const selectedIds = new Set(selectedGroupIds);
    return groups.filter((group) => selectedIds.has(group.id));
  }, [groups, selectedGroupIds]);

  const membershipValidation = useMemo(() => {
    const userGroups = Array.isArray(effectiveSelectedUser?.groups) ? effectiveSelectedUser.groups : [];
    const userGroupIds = new Set(
      userGroups
        .map((group) => String(group?.id || '').trim())
        .filter(Boolean)
    );

    return selectedGroups.map((group) => ({
      id: group.id,
      name: group.name || group.id,
      unresolved: Boolean(group.unresolved),
      existsInUser: userGroupIds.has(group.id),
    }));
  }, [selectedGroups, effectiveSelectedUser]);

  const filteredUsers = useMemo(() => {
    const query = normalizeSearch(userQuery);
    const items = query
      ? users.filter((user) =>
          [user.opid, user.display_name, user.email].some((value) => normalizeSearch(value).includes(query))
        )
      : users;
    return items.slice(0, 12);
  }, [userQuery, users]);

  const filteredGroups = useMemo(() => {
    const query = normalizeSearch(groupQuery);
    if (!effectiveSelectedUser || !query) {
      return [];
    }
    const selectedIds = new Set(selectedGroupIds);

    const matches = groups
      .filter((group) => isValidGroupId(group?.id))
      .filter((group) => [group.id, group.name].some((value) => normalizeSearch(value).includes(query)))
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
  }, [clickedGroups, effectiveSelectedUser, groupQuery, groups, selectedGroupIds]);

  const generatedScript = useMemo(
    () => buildAssociationScript(
      effectiveSelectedUser
        ? {
            id: effectiveSelectedUser.opid,
            name: effectiveSelectedUser.display_name || effectiveSelectedUser.opid,
            email: effectiveSelectedUser.email || '',
          }
        : null,
      membershipValidation
    ),
    [membershipValidation, effectiveSelectedUser]
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
    if (!effectiveSelectedUser) {
      setFlowMessage('Select a user before searching for additional groups.');
      return;
    }

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
        return mergeGroups(current, items);
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

  async function handleUserFlowLookup() {
    const targetOpid = String(embedded ? effectiveSelectedUserId : (selectedUserId || userQuery)).trim();
    if (!targetOpid) {
      setFlowMessage('Select a user OPID before calling Get User Groups.');
      return;
    }

    setUserFlowLoading(true);
    setError('');
    setFlowMessage('');

    try {
      const response = await getUserGroups(targetOpid);
      const normalized = normalizeFlowMembershipResponse(response, targetOpid);
      const cacheMap = readUserGroupsCacheMap();
      const nextCacheMap = upsertCachedUserRecord(normalized, cacheMap);
      writeUserGroupsCacheMap(nextCacheMap);

      const nextUsers = getCachedUsersFromMap(nextCacheMap);
      setUsers(nextUsers);
      setCacheUsersLoaded(nextUsers.length);
      if (!embedded) {
        setSelectedUserId(normalized.opid || targetOpid);
      }
      setGroups((current) => mergeGroups(current, normalized.groups || []));
      setFlowMessage(`Get User Groups returned ${normalized.groups.length} group${normalized.groups.length === 1 ? '' : 's'} for ${targetOpid}.`);
      if (typeof onUserCacheUpdated === 'function') {
        onUserCacheUpdated(normalized.opid || targetOpid);
      }
      debugLog('Get User Groups sub-flow run', {
        opid: targetOpid,
        groupsCount: normalized.groups.length,
      });
    } catch (requestError) {
      setError(requestError.message || 'Get User Groups flow failed.');
    } finally {
      setUserFlowLoading(false);
    }
  }

  if (loading) {
    return (
      <section className={embedded ? 'module module--embedded' : 'module'}>
        {!embedded ? (
          <SectionHeader
            tag="/app/work/user-group-association"
            title="User-Group Association"
            description="Reference-driven workspace for building group association scripts."
            actions={
              <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
                {`Back to ${backLabel}`}
              </button>
            }
          />
        ) : null}
        <EmptyState
          icon={<UsersRound size={20} />}
          title="Loading reference data"
          description={error || 'Fetching cached users and cached groups for the association workspace.'}
        />
      </section>
    );
  }

  return (
    <section className={embedded ? 'module module--embedded' : 'module'}>
      {!embedded ? (
        <SectionHeader
          tag="/app/work/user-group-association"
          title="User-Group Association"
          description="Select a cached user, target the right reference groups, and generate a reusable association script without leaving the Work module."
          actions={
            <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
              {`Back to ${backLabel}`}
            </button>
          }
        />
      ) : null}

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {copyMessage ? <p className="status-text">{copyMessage}</p> : null}
      {flowMessage ? <p className="status-text">{flowMessage}</p> : null}
      {!embedded && !error ? <p className="status-text">{`Loaded ${cacheUsersLoaded} cached user${cacheUsersLoaded === 1 ? '' : 's'} from Get User Groups cache.`}</p> : null}

      <div className="work-layout association-layout">
        <div className="card-grid association-column">
          {!embedded ? (
            <Card className="landing__card association-card">
              <CardHeader
                eyebrow="Step 1"
                title="Select User"
                description="Search cached users from Get User Groups and choose the identity the association run should target."
              />

              <div className="settings-form">
                <label className="settings-field">
                  <span>User search</span>
                  <input
                    type="text"
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                    placeholder="Search by OPID, name, or email"
                  />
                </label>
                <div className="association-toolbar">
                  <button
                    type="button"
                    className="ui-button ui-button--primary"
                    onClick={handleUserFlowLookup}
                    disabled={userFlowLoading}
                  >
                    <UsersRound size={16} />
                    {userFlowLoading ? 'Running Get User Groups...' : 'Run Get User Groups'}
                  </button>
                </div>
              </div>

              <div className="association-list" role="list" aria-label="Reference users">
                {filteredUsers.length ? (
                  filteredUsers.map((user) => {
                    const isSelected = user.opid === selectedUserId;
                    return (
                      <button
                        type="button"
                        key={user.opid}
                        className={isSelected ? 'association-list__item association-list__item--selected' : 'association-list__item'}
                        onClick={() => setSelectedUserId(user.opid)}
                      >
                        <span className="association-list__title">{user.display_name || user.opid}</span>
                        <span className="association-list__meta">{user.opid}</span>
                        {user.email ? <span className="association-list__meta">{user.email}</span> : null}
                      </button>
                    );
                  })
                ) : (
                  <EmptyState
                    icon={<Search size={18} />}
                    title="No matching users"
                    description="Adjust the search or run Get User Groups to add users to cache."
                  />
                )}
              </div>
            </Card>
          ) : null}

          <Card className="landing__card association-card">
            <CardHeader
              eyebrow={embedded ? 'Groups' : 'Step 2'}
              title="Select Groups"
              description={embedded
                ? `Working on ${effectiveSelectedUserId || 'the selected user'} from the Users context panel.`
                : 'Cached groups for the selected user load immediately. Use Power Automate only when you need additional results.'}
            />

            <div className="settings-form">
              <label className="settings-field">
                <span>Group search</span>
                <input
                  type="text"
                  value={groupQuery}
                  onChange={(event) => setGroupQuery(event.target.value)}
                  placeholder="Search by group id or name"
                  disabled={!effectiveSelectedUser}
                />
              </label>

              <div className="association-toolbar">
                {embedded ? (
                  <button
                    type="button"
                    className="ui-button ui-button--secondary"
                    onClick={handleUserFlowLookup}
                    disabled={userFlowLoading || !effectiveSelectedUser}
                  >
                    <UsersRound size={16} />
                    {userFlowLoading ? 'Running Get User Groups...' : 'Refresh User Cache'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ui-button ui-button--primary"
                  onClick={handleFlowLookup}
                  disabled={flowLoading || !effectiveSelectedUser}
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
                      <span className="association-list__meta">{clickCount ? `opened ${clickCount}x` : 'cached group'}</span>
                    </button>
                  );
                })
              ) : (
                !effectiveSelectedUser ? (
                  <EmptyState
                    icon={<Search size={18} />}
                    title="No user selected"
                    description={embedded ? 'Select a user from the Users page context panel.' : 'Select a cached user first to validate group membership.'}
                  />
                ) : !groupQuery.trim() ? (
                  <EmptyState
                    icon={<Search size={18} />}
                    title="Start typing to search groups"
                    description="Groups only appear after you enter a search term."
                  />
                ) : (
                  <EmptyState
                    icon={<Search size={18} />}
                    title="No matching groups"
                    description="Try another search term or use Search Power Automate for additional matches."
                  />
                )
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
                <strong>{effectiveSelectedUser ? effectiveSelectedUser.display_name || effectiveSelectedUser.opid : 'Select a user'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Email</span>
                <strong>{effectiveSelectedUser?.email || userContext?.email || 'No email in cache'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Selected Groups</span>
                <strong>{membershipValidation.length}</strong>
              </div>
            </div>

            <div className="association-validation">
              <div className="association-validation__header">
                <span>Group Name</span>
                <span>Status</span>
              </div>
              {membershipValidation.length ? (
                <div className="association-validation__list">
                  {membershipValidation.map((group) => (
                    <div className="association-validation__row" key={group.id}>
                      <span title={group.id}>
                        {group.name}
                        {group.unresolved ? ' (unresolved)' : ''}
                      </span>
                      <span className={group.existsInUser ? 'association-status association-status--assigned' : 'association-status association-status--missing'}>
                        {group.existsInUser ? 'Already Assigned' : 'Not Assigned'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ui-card__description">
                  {effectiveSelectedUser ? 'No groups selected. Choose one or more groups to validate.' : 'Select a user to begin validation.'}
                </p>
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
                  disabled={!effectiveSelectedUser}
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
                  generatedScript
                  || (!effectiveSelectedUser
                    ? (embedded ? '# Select a user from the Users context panel first.' : '# Select a user first.')
                    : '# Select one or more groups to validate and generate script output.')
                }
              />
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
