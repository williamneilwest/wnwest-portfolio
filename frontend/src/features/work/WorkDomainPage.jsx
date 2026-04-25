import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { ModuleCard } from '../../components/modules/ModuleCard';
import { EmptyState } from '../../app/ui/EmptyState';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { isCsvFile } from '../../app/utils/documentFiles';
import { parseCsvText } from '../../app/utils/csvDataset';
import {
  getDeviceLocationSource,
  getUserDevices,
  getUploadFile,
  getUploads,
  searchHardwareRmrByPcName,
  searchDeviceLocations,
  searchGroupsCacheFirst,
  searchUsersPeopleSoftBackup,
  searchUsers,
  uploadDataFile
} from '../../app/services/api';
import { SoftwareRegistryPage } from '../software/SoftwareRegistryPage';
import { getCachedUsersFromMap, readUserGroupsCacheMap, upsertCachedUserRecord, writeUserGroupsCacheMap } from './userGroupsCache';
import { GroupsSearchCard } from './components/GroupsSearchCard';

const DOMAIN_CONFIG = {
  users: {
    title: 'Users',
    description: 'User identity, membership, and action modules.',
  },
  printers: {
    title: 'Printers',
    description: 'Read-only printer directory from the saved PrintersLAH upload.',
  },
  groups: {
    title: 'Groups',
    description: 'Group entity workspace (modules expanding here next).',
  },
  hardware: {
    title: 'Hardware',
    description: 'Hardware entity workspace (modules expanding here next).',
  },
  software: {
    title: 'Software',
    description: 'Software entity workspace (modules expanding here next).',
  },
};

const PEOPLESOFT_BACKUP_SOURCE_NAME = 'u_users__peoplesoft_locations';

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUploadTitle(file) {
  return String(file?.originalName || file?.filename || '')
    .trim()
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isLikelyPcName(value) {
  return /^LAH[LD]/i.test(String(value || '').trim());
}

function shouldRunHardwareLookup(value) {
  const query = String(value || '').trim();
  if (!query) {
    return false;
  }
  if (/^\d+$/.test(query)) {
    return query.length >= 3;
  }
  return true;
}

function isOpid(input) {
  return /^[a-zA-Z0-9]{6}$/.test(String(input || '').trim());
}

function userMatchesQuery(user, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery || !user || typeof user !== 'object') {
    return false;
  }

  return [user.opid, user.display_name, user.name, user.email]
    .map((value) => normalizeSearch(value))
    .filter(Boolean)
    .some((value) => value.includes(normalizedQuery));
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'disabled'].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeSourceUser(user) {
  const opid = String(user?.opid || user?.user_id || user?.id || '').trim();
  if (!opid) {
    return null;
  }

  return {
    opid,
    display_name: String(user?.display_name || user?.name || '').trim() || null,
    email: String(user?.email || user?.mail || '').trim() || null,
    job_title: String(user?.job_title || user?.title || '').trim() || null,
    department: String(user?.department || '').trim() || null,
    location: String(user?.location || '').trim() || null,
    physician: String(user?.physician || user?.u_physician || user?.user_u_physician || '').trim() || null,
    cost_center: String(user?.cost_center || user?.user_cost_center || '').trim() || null,
    manager: String(user?.manager || user?.u_manager || user?.user_manager || user?.cost_center_manager_name || '').trim() || null,
    director: String(user?.director || user?.u_director || user?.user_u_director || user?.director_name || '').trim() || null,
    account_enabled: toBoolean(user?.account_enabled),
    groups: [],
    cached_at: new Date().toISOString(),
    source: String(user?.source || 'users_master').trim() || 'users_master',
  };
}

function getSingleSearchMatch(items = [], query = '') {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (normalizedItems.length === 1) {
    return normalizedItems[0];
  }

  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return null;
  }

  const exactMatches = normalizedItems.filter((item) => {
    const normalized = normalizeSourceUser(item);
    if (!normalized) {
      return false;
    }
    return [normalized.opid, normalized.display_name, normalized.email]
      .map((value) => normalizeSearch(value))
      .filter(Boolean)
      .some((value) => value === normalizedQuery);
  });

  return exactMatches.length === 1 ? exactMatches[0] : null;
}

function formatTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatFieldLabel(key) {
  const formatted = String(key || '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return formatted.replace(/^U\s+/i, '');
}

function getUserFieldPriority(key) {
  const normalized = String(key || '').trim().toLowerCase();
  const order = [
    ['name'],
    ['job_title', 'title'],
    ['department'],
    ['cost_center', 'user_cost_center'],
    ['location'],
    ['u_epic_assignment_group', 'epic_group_name'],
    ['manager', 'u_manager', 'user_manager', 'cost_center_manager_name'],
    ['director', 'u_director', 'user_u_director', 'director_name'],
  ];

  const index = order.findIndex((group) => group.includes(normalized));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getPreferredUserFieldLabel(key) {
  const normalized = String(key || '').trim().toLowerCase();
  if (normalized === 'cost_center' || normalized === 'user_cost_center') {
    return 'Cost Center';
  }
  if (normalized === 'job_title' || normalized === 'title') {
    return 'Job Title';
  }
  if (normalized === 'u_epic_assignment_group' || normalized === 'epic_group_name') {
    return 'Epic Assignment Group';
  }
  if (normalized === 'manager' || normalized === 'u_manager' || normalized === 'user_manager' || normalized === 'cost_center_manager_name') {
    return 'Cost Center Manager Name';
  }
  if (normalized === 'director' || normalized === 'u_director' || normalized === 'user_u_director' || normalized === 'director_name') {
    return 'Director Name';
  }
  if (normalized === 'u_director') {
    return 'Director';
  }
  return formatFieldLabel(key);
}

function buildUserContext(selectedUser, cacheMap) {
  if (!selectedUser?.opid) {
    return null;
  }

  const raw = cacheMap?.[selectedUser.opid] || null;
  const groups = Array.isArray(selectedUser.groups) ? selectedUser.groups : [];
  const cachedCount = Number(raw?.totalCount ?? raw?.total_count ?? groups.length) || groups.length;

  return {
    ...(raw && typeof raw === 'object' ? raw : {}),
    opid: selectedUser.opid,
    display_name: selectedUser.display_name || selectedUser.name || null,
    email: selectedUser.email || null,
    job_title: selectedUser.job_title || null,
    department: selectedUser.department || null,
    location: selectedUser.location || null,
    physician: selectedUser.physician || null,
    cost_center: selectedUser.cost_center || null,
    manager: selectedUser.manager || null,
    director: selectedUser.director || null,
    account_enabled: selectedUser.account_enabled ?? null,
    group_count: cachedCount,
    groups,
    last_updated: raw?.cachedAt || raw?.cached_at || selectedUser.cached_at || null,
    source: raw?.source || selectedUser.source || 'cache',
  };
}

function buildUserFieldEntries(record, normalizedUser = null) {
  const normalized = normalizedUser || normalizeSourceUser(record) || {};
  const hiddenFieldKeys = new Set([
    'user',
    'user_name',
    'u_peoplesoft_location',
    'source',
    'groups',
    'items',
    'resolvedGroups',
    'cachedAt',
    'cached_at',
    'created',
    'physician',
    'u_physician',
    'user_u_physician',
    '__fallback_used',
  ]);

  const seenFieldValues = new Set();

  return Object.entries(record || {})
    .filter(([key, value]) => {
      if (value === null || value === undefined) {
        return false;
      }
      if (hiddenFieldKeys.has(String(key || '').trim())) {
        return false;
      }
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return false;
      }
      const text = String(value).trim();
      if (!text) {
        return false;
      }
      if (key === 'title' && text === String(record?.job_title || '').trim()) {
        return false;
      }
      if (key === 'epic_group_name' && text === String(record?.u_epic_assignment_group || '').trim()) {
        return false;
      }
      if (key === 'display_name' && text === String(normalized.display_name || '').trim()) {
        return false;
      }
      if (key === 'opid' && text === String(normalized.opid || '').trim()) {
        return false;
      }
      const dedupeKey = `${getPreferredUserFieldLabel(key).toLowerCase()}::${text.toLowerCase()}`;
      if (seenFieldValues.has(dedupeKey)) {
        return false;
      }
      seenFieldValues.add(dedupeKey);
      return true;
    })
    .sort(([leftKey], [rightKey]) => {
      const leftPriority = getUserFieldPriority(leftKey);
      const rightPriority = getUserFieldPriority(rightKey);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return getPreferredUserFieldLabel(leftKey).localeCompare(getPreferredUserFieldLabel(rightKey));
    });
}

function isPeopleSoftBackupUser(user) {
  return String(user?.source || '').trim().toLowerCase() === PEOPLESOFT_BACKUP_SOURCE_NAME;
}

function hasCompleteBackupProfile(user) {
  if (!isPeopleSoftBackupUser(user)) {
    return false;
  }

  return [
    String(user?.display_name || '').trim(),
    String(user?.job_title || '').trim(),
    String(user?.department || '').trim(),
    String(user?.location || '').trim(),
  ].every(Boolean);
}

function UsersEntityWorkspace() {
  const [searchParams] = useSearchParams();
  const [cacheUsers, setCacheUsers] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [selectedUserOpid, setSelectedUserOpid] = useState('');
  const [userContext, setUserContext] = useState(null);
  const [sourceSearchResults, setSourceSearchResults] = useState([]);
  const [localSearchLoading, setLocalSearchLoading] = useState(false);
  const [backupSearching, setBackupSearching] = useState(false);
  const [backupSourceName, setBackupSourceName] = useState('');
  const [userDevices, setUserDevices] = useState([]);
  const [userDevicesLoading, setUserDevicesLoading] = useState(false);
  const [userDevicesError, setUserDevicesError] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [userGroupIds, setUserGroupIds] = useState([]);
  const selectedGroupsUserRef = useRef('');
  const autoLookupQueryRef = useRef('');
  const lockedBackupProfileOpidRef = useRef('');

  const clearSelectedUserContext = useCallback(() => {
    setSelectedUserOpid('');
    setUserContext(null);
    setUserGroupIds([]);
    setSelectedGroups([]);
    selectedGroupsUserRef.current = '';
  }, []);

  const refreshUsersFromCache = useCallback((nextSelectedOpid = '') => {
    const cacheMap = readUserGroupsCacheMap();
    const users = getCachedUsersFromMap(cacheMap);
    setCacheUsers(users);

    setSelectedUserOpid((current) => {
      const explicit = String(nextSelectedOpid || '').trim();
      if (explicit && users.some((user) => user.opid === explicit)) {
        return explicit;
      }
      if (current && users.some((user) => user.opid === current)) {
        return current;
      }
      return users[0]?.opid || '';
    });
  }, []);

  useEffect(() => {
    refreshUsersFromCache();
  }, [refreshUsersFromCache]);

  useEffect(() => {
    const query = userQuery.trim();
    if (query.length < 2) {
      setSourceSearchResults([]);
      setBackupSourceName('');
      setLocalSearchLoading(false);
      return;
    }

    const currentSelectedUser = cacheUsers.find((user) => user.opid === selectedUserOpid) || null;
    if (currentSelectedUser && !userMatchesQuery(currentSelectedUser, query)) {
      clearSelectedUserContext();
    }

    let isMounted = true;
    const timer = setTimeout(() => {
      setLocalSearchLoading(true);
      setBackupSourceName('');

      const runSearch = async () => {
        const exactOpidSearch = isOpid(query) && query.length === 6;

        try {
          if (exactOpidSearch) {
            const cachedMatches = cacheUsers
              .filter((user) => [user.opid, user.display_name, user.email].some((value) => normalizeSearch(value).includes(normalizeSearch(query))))
              .slice(0, 20)
              .map((user) => ({
                opid: user.opid,
                display_name: user.display_name || 'Unknown User',
                name: user.display_name || 'Unknown User',
                email: user.email || '',
                job_title: user.job_title || '',
                department: user.department || '',
                location: user.location || '',
                physician: user.physician || '',
                cost_center: user.cost_center || '',
                manager: user.manager || '',
                director: user.director || '',
                account_enabled: user.account_enabled,
                source: user.source || 'cache',
              }));

            if (!isMounted) {
              return;
            }

            setSourceSearchResults(cachedMatches);
            const singleCachedMatch = getSingleSearchMatch(cachedMatches, query);
            if (singleCachedMatch) {
              if (String(singleCachedMatch.opid || '').trim() !== String(selectedUserOpid || '').trim()) {
                addToCache(singleCachedMatch);
              }
              return;
            }
            return;
          }

          setBackupSearching(true);
          const payload = await searchUsersPeopleSoftBackup(query, { limit: 20 });
          if (!isMounted) {
            return;
          }

          const items = Array.isArray(payload?.items) ? payload.items : [];
          setBackupSourceName(String(payload?.source_name || '').trim());
          setSourceSearchResults(items);
          const singleBackupMatch = getSingleSearchMatch(items, query);
          if (singleBackupMatch) {
            if (String(singleBackupMatch.opid || '').trim() !== String(selectedUserOpid || '').trim()) {
              addToCache(singleBackupMatch);
            }
          } else if (!items.length) {
            clearSelectedUserContext();
          }
        } catch {
          if (!isMounted) {
            return;
          }
          clearSelectedUserContext();
          setSourceSearchResults([]);
          setBackupSourceName('');
        } finally {
          if (isMounted) {
            setLocalSearchLoading(false);
            setBackupSearching(false);
          }
        }
      };

      void runSearch();
    }, 280);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [cacheUsers, clearSelectedUserContext, selectedUserOpid, userQuery]);

  const selectedUser = useMemo(
    () => cacheUsers.find((user) => user.opid === selectedUserOpid) || null,
    [cacheUsers, selectedUserOpid]
  );

  useEffect(() => {
    const cacheMap = readUserGroupsCacheMap();
    setUserContext(buildUserContext(selectedUser, cacheMap));
    const groups = Array.isArray(selectedUser?.groups) ? selectedUser.groups : [];
    const currentUserOpid = String(selectedUser?.opid || '').trim();
    if (selectedGroupsUserRef.current !== currentUserOpid) {
      setSelectedGroups([]);
      selectedGroupsUserRef.current = currentUserOpid;
    }
    setUserGroupIds(
      groups
        .map((group) => String(group?.id || group?.group_id || '').trim())
        .filter(Boolean)
    );
    if (!selectedUser?.opid) {
      setSelectedGroups([]);
      setUserGroupIds([]);
      return;
    }
  }, [selectedUser]);

  useEffect(() => {
    const selectedOpid = String(selectedUser?.opid || '').trim();
    if (!selectedOpid) {
      setUserDevices([]);
      setUserDevicesError('');
      setUserDevicesLoading(false);
      return;
    }

    let isMounted = true;
    setUserDevicesLoading(true);
    setUserDevicesError('');

    getUserDevices(selectedOpid, {
      name: selectedUser?.display_name || selectedUser?.name || '',
      email: selectedUser?.email || '',
    })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setUserDevices(Array.isArray(payload?.devices) ? payload.devices : []);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setUserDevices([]);
        setUserDevicesError(error.message || 'User devices could not be loaded.');
      })
      .finally(() => {
        if (isMounted) {
          setUserDevicesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedUser]);

  useEffect(() => {
    // Debug visibility of raw user object from API/context.
    // eslint-disable-next-line no-console
    console.log('USER DATA:', userContext);
  }, [userContext]);

  function addToCache(user) {
    const normalized = normalizeSourceUser(user);
    if (!normalized) {
      return;
    }

    const existingUser = cacheUsers.find((item) => item.opid === normalized.opid) || null;
    const isSameAsExisting = existingUser
      && String(existingUser.display_name || '').trim() === String(normalized.display_name || '').trim()
      && String(existingUser.email || '').trim() === String(normalized.email || '').trim()
      && String(existingUser.job_title || '').trim() === String(normalized.job_title || '').trim()
      && String(existingUser.department || '').trim() === String(normalized.department || '').trim()
      && String(existingUser.location || '').trim() === String(normalized.location || '').trim()
      && String(existingUser.physician || '').trim() === String(normalized.physician || '').trim()
      && String(existingUser.cost_center || '').trim() === String(normalized.cost_center || '').trim()
      && String(existingUser.manager || '').trim() === String(normalized.manager || '').trim()
      && String(existingUser.director || '').trim() === String(normalized.director || '').trim()
      && String(existingUser.source || '').trim() === String(normalized.source || '').trim();

    if (hasCompleteBackupProfile(normalized)) {
      lockedBackupProfileOpidRef.current = normalized.opid;
      setUserContext((current) => ({
        ...(current && String(current.opid || '').trim() === normalized.opid ? current : {}),
        opid: normalized.opid,
        display_name: normalized.display_name,
        email: normalized.email,
        job_title: normalized.job_title,
        department: normalized.department,
        location: normalized.location,
        physician: normalized.physician,
        cost_center: normalized.cost_center,
        manager: normalized.manager,
        director: normalized.director,
        account_enabled: normalized.account_enabled,
        groups: Array.isArray(current?.groups) ? current.groups : [],
        group_count: Array.isArray(current?.groups) ? current.groups.length : 0,
        last_updated: new Date().toISOString(),
        source: normalized.source,
      }));
    } else if (lockedBackupProfileOpidRef.current === normalized.opid) {
      lockedBackupProfileOpidRef.current = '';
    }

    if (isSameAsExisting && String(selectedUserOpid || '').trim() === normalized.opid) {
      return;
    }

    const cacheMap = readUserGroupsCacheMap();
    const nextCacheMap = upsertCachedUserRecord(normalized, cacheMap);
    writeUserGroupsCacheMap(nextCacheMap);
    refreshUsersFromCache(normalized.opid);
    setSelectedUserOpid(normalized.opid);
  }

  async function runPeopleSoftBackupLookup(overrideQuery = '', { autoSelect = false } = {}) {
    const query = String(overrideQuery || userQuery || '').trim();
    if (query.length < 2) {
      return;
    }

    try {
      setBackupSearching(true);
      const payload = await searchUsersPeopleSoftBackup(query, { limit: 20 });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setBackupSourceName(String(payload?.source_name || '').trim());
      setSourceSearchResults(items);
      if (autoSelect) {
        const singleBackupMatch = getSingleSearchMatch(items, query);
        if (singleBackupMatch) {
          if (String(singleBackupMatch.opid || '').trim() !== String(selectedUserOpid || '').trim()) {
            addToCache(singleBackupMatch);
          }
        } else if (!items.length) {
          clearSelectedUserContext();
        }
      } else if (!items.length) {
        clearSelectedUserContext();
      }
    } catch {
      clearSelectedUserContext();
      setSourceSearchResults([]);
      setBackupSourceName('');
    } finally {
      setBackupSearching(false);
    }
  }

  useEffect(() => {
    const queryParam = String(searchParams.get('query') || '').trim();
    const lookupParam = String(searchParams.get('lookup') || '').trim().toLowerCase();

    if (!queryParam) {
      autoLookupQueryRef.current = '';
      return;
    }

    setUserQuery((current) => (current === queryParam ? current : queryParam));

    if (lookupParam !== 'peoplesoft') {
      return;
    }

    const normalizedAutoLookupKey = `${lookupParam}:${queryParam.toLowerCase()}`;
    if (autoLookupQueryRef.current === normalizedAutoLookupKey) {
      return;
    }

    autoLookupQueryRef.current = normalizedAutoLookupKey;
    void runPeopleSoftBackupLookup(queryParam, { autoSelect: true });
  }, [searchParams]);

  async function addGroupToContext(group) {
    const normalized = {
      id: String(group?.id || group?.group_id || '').trim(),
      name: String(group?.name || '').trim() || null,
      description: String(group?.description || '').trim(),
      enriched: typeof group?.enriched === 'boolean' ? group.enriched : Boolean(String(group?.name || '').trim()),
    };
    if (!normalized.id) {
      return;
    }
    let candidate = normalized;
    if (!candidate.enriched || !candidate.name) {
      try {
        const refreshed = await searchGroupsCacheFirst(candidate.id, { refresh: true });
        const match = Array.isArray(refreshed?.results)
          ? refreshed.results.find((item) => String(item?.id || item?.group_id || '').trim() === candidate.id)
          : null;
        if (match) {
          candidate = {
            id: String(match?.id || match?.group_id || '').trim(),
            name: String(match?.name || '').trim() || null,
            description: String(match?.description || '').trim(),
            enriched: Boolean(String(match?.name || '').trim()),
          };
        }
      } catch {
        // keep non-blocking add behavior
      }
    }
    setSelectedGroups((current) => {
      if (current.some((item) => item.id === candidate.id)) {
        return current;
      }
      return [...current, candidate];
    });
  }

  function removeGroupFromContext(groupId) {
    const normalized = String(groupId || '').trim();
    if (!normalized) {
      return;
    }
    setSelectedGroups((current) => current.filter((item) => item.id !== normalized));
  }

  const enrichedGroups = useMemo(
    () => selectedGroups.filter((group) => Boolean(String(group?.name || '').trim())),
    [selectedGroups]
  );

  return (
    <div className="entity-tools-layout">
      <aside className="entity-tools-layout__left entity-tools-layout__left--tight">
        <Card className="user-context-card">
          <CardHeader
            eyebrow="User Context"
            title={selectedUser ? (selectedUser.display_name || 'Unknown User') : 'Select a User'}
            action={(
              <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled
                title="External flow refresh is disabled. This page only uses cached and backup data."
                onClick={(event) => event.preventDefault()}
              >
                Refresh from Flow Disabled
              </button>
            )}
          />

          <label className="settings-field">
            <span>User Search</span>
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
              className="ui-button ui-button--secondary"
              disabled={backupSearching || userQuery.trim().length < 2}
              onClick={() => void runPeopleSoftBackupLookup()}
            >
              {backupSearching ? 'Searching Backup...' : 'Search PeopleSoft Backup'}
            </button>
          </div>

          <div className="association-list association-list--fit" role="list" aria-label="User search results">
            {userQuery.trim().length < 2 ? <p className="status-text">Type at least 2 characters to search.</p> : null}
            {userQuery.trim().length >= 2 && localSearchLoading ? <p className="status-text">Searching users...</p> : null}
            {userQuery.trim().length >= 2 && !localSearchLoading && backupSearching ? <p className="status-text">Searching PeopleSoft backup...</p> : null}
            {userQuery.trim().length >= 2 && !localSearchLoading && !backupSearching && sourceSearchResults.length ? (
              sourceSearchResults.slice(0, 20).map((result) => {
                const normalized = normalizeSourceUser(result);
                if (!normalized) {
                  return null;
                }
                const isSelected = normalized.opid === selectedUserOpid;
                const accountEnabled = toBoolean(result?.account_enabled);
                const fieldEntries = buildUserFieldEntries(result, normalized);
                const isPhysician = toBoolean(result?.physician ?? result?.u_physician ?? result?.user_u_physician) === true;
                return (
                  <div
                    key={`search-${normalized.opid}`}
                    className={isSelected ? 'association-list__item association-list__item--selected' : 'association-list__item'}
                  >
                    <span className="association-list__title">{normalized.display_name || 'Unknown User'}</span>
                    {isPhysician ? (
                      <span className="association-status association-status--live">Physician</span>
                    ) : null}
                    {fieldEntries.map(([key, value]) => (
                      <span className="association-list__meta" key={`${normalized.opid}-${key}`}>
                        {`${getPreferredUserFieldLabel(key)}: ${String(value).trim()}`}
                      </span>
                    ))}
                    {accountEnabled !== null ? (
                      <span className={accountEnabled ? 'association-status association-status--assigned' : 'association-status association-status--missing'}>
                        {accountEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    ) : null}
                    {!isSelected ? (
                      <div className="association-toolbar">
                        <button type="button" className="ui-button ui-button--secondary" onClick={() => addToCache(result)}>
                          Select User
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : null}
            {userQuery.trim().length >= 2 && !localSearchLoading && !backupSearching && !sourceSearchResults.length ? (
              <>
                <EmptyState title="No matching users" description="No user found in cached users or the PeopleSoft backup source." />
              </>
            ) : null}
          </div>

        </Card>

        <Card className="user-groups-context-card">
          <CardHeader
            eyebrow="User Groups Context"
            title="Selected Groups"
            description={`${enrichedGroups.length} enriched group${enrichedGroups.length === 1 ? '' : 's'} selected.`}
          />
          {!enrichedGroups.length ? (
            <EmptyState title="No enriched groups yet." description="Search to load group details." />
          ) : (
            <div className="association-list user-groups-context-list">
              {enrichedGroups.map((group) => (
                <div key={group.id} className="association-list__item user-groups-context-list__item">
                  <span className="association-list__title">{group.name}</span>
                  <div className="association-toolbar">
                    <button
                      type="button"
                      className="ui-button ui-button--secondary"
                      onClick={() => removeGroupFromContext(group.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="user-groups-context-card">
          <CardHeader
            eyebrow="Devices"
            title="Associated Hardware"
            description={selectedUser?.opid ? `Hardware rows associated with ${selectedUser.display_name || selectedUser.opid}.` : 'Select a user to load hardware associations.'}
          />
          {!selectedUser?.opid ? (
            <EmptyState title="No user selected" description="Choose a user to load associated hardware from the backend hardware table." />
          ) : null}
          {selectedUser?.opid && userDevicesLoading ? <p className="status-text">Loading associated hardware...</p> : null}
          {selectedUser?.opid && userDevicesError ? <p className="status-text status-text--error">{userDevicesError}</p> : null}
          {selectedUser?.opid && !userDevicesLoading && !userDevicesError && !userDevices.length ? (
            <EmptyState title="No associated hardware" description="No hardware rows in the backend source matched this user." />
          ) : null}
          {selectedUser?.opid && userDevices.length ? (
            <div className="association-list user-groups-context-list">
              {userDevices.map((device, index) => {
                const deviceId = String(device?.id || device?.asset_tag || device?.name || '').trim() || `device-${index}`;
                return (
                  <div key={deviceId} className="association-list__item user-groups-context-list__item">
                    <span className="association-list__title">{String(device?.name || 'Unknown device').trim() || 'Unknown device'}</span>
                    {String(device?.model || '').trim() ? (
                      <span className="association-list__meta">{`Model: ${String(device.model).trim()}`}</span>
                    ) : null}
                    {String(device?.asset_tag || '').trim() ? (
                      <span className="association-list__meta">{`Asset Tag: ${String(device.asset_tag).trim()}`}</span>
                    ) : null}
                    {String(device?.serial_number || '').trim() ? (
                      <span className="association-list__meta">{`Serial Number: ${String(device.serial_number).trim()}`}</span>
                    ) : null}
                    {String(device?.assigned_to || '').trim() ? (
                      <span className="association-list__meta">{`Assigned To: ${String(device.assigned_to).trim()}`}</span>
                    ) : null}
                    {String(device?.department || '').trim() ? (
                      <span className="association-list__meta">{`Department: ${String(device.department).trim()}`}</span>
                    ) : null}
                    {String(device?.location || '').trim() ? (
                      <span className="association-list__meta">{`Location: ${String(device.location).trim()}`}</span>
                    ) : null}
                    {String(device?.status || '').trim() ? (
                      <span className="association-list__meta">{`Status: ${String(device.status).trim()}`}</span>
                    ) : null}
                    {String(device?.ip || '').trim() ? (
                      <span className="association-list__meta">{`IP: ${String(device.ip).trim()}`}</span>
                    ) : null}
                    {String(device?.manufacturer || '').trim() ? (
                      <span className="association-list__meta">{`Manufacturer: ${String(device.manufacturer).trim()}`}</span>
                    ) : null}
                    {String(device?.last_seen || '').trim() ? (
                      <span className="association-list__meta">{`Last Seen: ${String(device.last_seen).trim()}`}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </Card>
      </aside>

      <section className="entity-tools-layout__right entity-tools-layout__right--primary">
        <GroupsSearchCard
          className="groups-search-card"
          user={userContext}
          defaultGroups={selectedGroups}
          userGroupIds={userGroupIds}
          onAddGroup={addGroupToContext}
        />
      </section>
    </div>
  );
}

function PlaceholderEntityWorkspace({ label }) {
  return (
    <Card>
      <CardHeader eyebrow="Entity" title={`${label} Modules`} description="Module container is ready. Tools are being migrated from standalone flow pages." />
      <p className="status-text">This entity page is now the source of truth for future tool modules.</p>
    </Card>
  );
}

const SAVED_PRINTERS_FILE = 'PrintersLAH.csv';
const SAVED_PRINTERS_KEY = 'printerslah';
const PRINTER_PAGE_SIZE = 12;

function findSavedPrinterUpload(files) {
  return (Array.isArray(files) ? files : []).find((file) => normalizeUploadTitle(file) === SAVED_PRINTERS_KEY) || null;
}

function getPrinterField(row, candidates) {
  for (const candidate of candidates) {
    const value = String(row?.[candidate] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizePrinterRow(row, index) {
  const name = getPrinterField(row, ['name', 'printer', 'printer_name', 'sharename']);
  const shareName = getPrinterField(row, ['sharename', 'share_name', 'queue', 'queue_name']);
  const ipAddress = getPrinterField(row, ['portname', 'port_name', 'ip', 'ip_address', 'address']);
  const status = getPrinterField(row, ['printerstatus', 'printer_status', 'status']);
  const driver = getPrinterField(row, ['drivername', 'driver_name', 'driver']);
  const location = getPrinterField(row, ['location', 'site', 'room']);
  const comment = getPrinterField(row, ['comment', 'comments', 'description', 'notes']);

  return {
    id: `${name || shareName || ipAddress || 'printer'}-${index}`,
    name: name || shareName || 'Unnamed printer',
    shareName,
    ipAddress,
    status,
    driver,
    location,
    comment,
    row,
  };
}

function PrinterRecordCard({ printer }) {
  return (
    <article className="printer-record-card">
      <div className="printer-record-card__main">
        <strong>{printer.name}</strong>
        <small>{printer.ipAddress || 'No IP/port listed'}</small>
      </div>
      <div className="printer-record-card__meta">
        <span>{printer.status || 'Unknown status'}</span>
        <span>{printer.location || 'No location'}</span>
        <span>{printer.driver || 'No driver'}</span>
      </div>
      {printer.comment ? <p>{printer.comment}</p> : null}
    </article>
  );
}

function PrintersEntityWorkspace() {
  const { isAdmin } = useCurrentUser();
  const [uploads, setUploads] = useState([]);
  const [savedUploadUrl, setSavedUploadUrl] = useState('');
  const [dataset, setDataset] = useState({ fileName: '', columns: [], rows: [] });
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewMode, setViewMode] = useState('cards');
  const [page, setPage] = useState(0);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    getUploads()
      .then((items) => {
        if (!isMounted) {
          return;
        }
        setUploads((Array.isArray(items) ? items : []).filter((file) => isCsvFile(file.filename, file.mimeType)));
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(requestError.message || 'Uploaded CSV files could not be loaded.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingUploads(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function loadPrinterCsv(fileName, csvText) {
    const parsed = parseCsvText(csvText);
    if (!parsed.columns.length) {
      setDataset({ fileName: '', columns: [], rows: [] });
      setError('PrintersLAH.csv did not include a readable header row.');
      return;
    }

    setDataset({ fileName, columns: parsed.columns, rows: parsed.rows });
    setError('');
  }

  useEffect(() => {
    if (loadingUploads || dataset.fileName) {
      return;
    }

    const savedUpload = findSavedPrinterUpload(uploads);
    if (!savedUpload) {
      setMessage(`${SAVED_PRINTERS_FILE} has not been uploaded yet.`);
      return;
    }

    let isMounted = true;
    async function loadSavedUpload() {
      setLoadingDataset(true);
      setError('');
      setMessage('');
      try {
        const csvText = await getUploadFile(savedUpload.url);
        if (!isMounted) {
          return;
        }
        await loadPrinterCsv(savedUpload.filename || SAVED_PRINTERS_FILE, csvText);
        setSavedUploadUrl(savedUpload.url || '');
        setMessage(`${formatDataFileName(savedUpload.filename || SAVED_PRINTERS_FILE)} loaded.`);
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || `${SAVED_PRINTERS_FILE} could not be loaded.`);
        }
      } finally {
        if (isMounted) {
          setLoadingDataset(false);
        }
      }
    }

    void loadSavedUpload();
    return () => {
      isMounted = false;
    };
  }, [dataset.fileName, loadingUploads, uploads]);

  async function handlePrinterFileReplacement(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isAdmin) {
      setError('Only admins can replace the saved printer CSV.');
      return;
    }

    setLoadingDataset(true);
    setError('');
    setMessage('');
    try {
      const csvText = await file.text();
      await loadPrinterCsv(SAVED_PRINTERS_FILE, csvText);

      try {
        const fixedFile = new File([csvText], SAVED_PRINTERS_FILE, { type: file.type || 'text/csv' });
        const uploaded = await uploadDataFile(fixedFile);
        const uploadedUrl = uploaded?.fileUrl || '';
        if (uploadedUrl) {
          const nextUpload = {
            filename: uploaded.fileName || SAVED_PRINTERS_FILE,
            url: uploadedUrl,
            mimeType: file.type || 'text/csv',
            modifiedAt: new Date().toISOString(),
            source: 'manual',
          };
          setUploads((current) => [nextUpload, ...current.filter((item) => item.url !== uploadedUrl)]);
          setSavedUploadUrl(uploadedUrl);
          setMessage(`${formatDataFileName(nextUpload.filename)} replaced and loaded.`);
        } else {
          setMessage(`${formatDataFileName(SAVED_PRINTERS_FILE)} loaded locally.`);
        }
      } catch (uploadError) {
        setMessage(`${formatDataFileName(SAVED_PRINTERS_FILE)} loaded locally. Upload save failed: ${uploadError.message || 'Unknown error'}`);
      }
    } catch (requestError) {
      setError(requestError.message || 'Printer CSV file could not be read.');
    } finally {
      setLoadingDataset(false);
      event.target.value = '';
    }
  }

  const printers = useMemo(() => dataset.rows.map(normalizePrinterRow), [dataset.rows]);
  const filteredPrinters = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) {
      return printers;
    }

    return printers.filter((printer) => {
      const primaryText = [
        printer.name,
        printer.shareName,
        printer.ipAddress,
        printer.location,
        printer.driver,
        printer.status,
        printer.comment,
      ].join(' ').toLowerCase();
      return primaryText.includes(normalizedQuery);
    });
  }, [printers, query]);

  useEffect(() => {
    setPage(0);
  }, [query, viewMode]);

  const totalPages = Math.max(1, Math.ceil(filteredPrinters.length / PRINTER_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pagedPrinters = useMemo(() => {
    const start = clampedPage * PRINTER_PAGE_SIZE;
    return filteredPrinters.slice(start, start + PRINTER_PAGE_SIZE);
  }, [clampedPage, filteredPrinters]);

  const statusCounts = useMemo(() => {
    const counts = new Map();
    for (const printer of printers) {
      const status = printer.status || 'Unknown';
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
  }, [printers]);

  const topLocations = useMemo(() => {
    const counts = new Map();
    for (const printer of printers) {
      const location = printer.location || 'Unknown';
      counts.set(location, (counts.get(location) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([location, count]) => ({ location, count }))
      .sort((left, right) => right.count - left.count || left.location.localeCompare(right.location))
      .slice(0, 6);
  }, [printers]);

  return (
    <div className="printers-workspace">
      <Card className="printers-results-card">
        <CardHeader
          eyebrow="Printer Search"
          title="Printer Directory"
          description={`${filteredPrinters.length.toLocaleString()} of ${printers.length.toLocaleString()} printer${printers.length === 1 ? '' : 's'} shown.`}
          action={(
            <button
              className={settingsOpen ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              Settings
            </button>
          )}
        />

        <div className="printers-directory-toolbar">
          <label className="settings-field printers-search-field">
            <span>Printer name or IP</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: SDCASPECCLN1 or 10.171.85.107"
            />
          </label>
          <label className="printer-view-switch">
            <input
              checked={viewMode === 'table'}
              type="checkbox"
              onChange={(event) => setViewMode(event.target.checked ? 'table' : 'cards')}
            />
            <span aria-hidden="true" />
            <strong>{viewMode === 'table' ? 'Table view' : 'Card view'}</strong>
          </label>
        </div>

        {settingsOpen ? (
          <div className="printers-settings-panel">
            <div className="printers-source-status">
              <span>
                <strong>{formatDataFileName(SAVED_PRINTERS_FILE)}</strong>
                <small>{savedUploadUrl ? 'Saved upload found' : loadingUploads ? 'Looking for saved upload...' : 'Saved upload not found'}</small>
              </span>
              <span>
                <strong>{printers.length.toLocaleString()}</strong>
                <small>Total printer rows</small>
              </span>
              <span>
                <strong>{filteredPrinters.length.toLocaleString()}</strong>
                <small>Search matches</small>
              </span>
            </div>
            {isAdmin ? (
              <label className="printer-file-replace">
                Replace CSV
                <input accept=".csv,text/csv" type="file" onChange={handlePrinterFileReplacement} />
              </label>
            ) : null}
            {message ? <p className="status-text">{message}</p> : null}
            {error ? <p className="status-text status-text--error">{error}</p> : null}
            {loadingDataset ? <p className="status-text">Loading printer data...</p> : null}
          </div>
        ) : null}

        {filteredPrinters.length ? (
          <>
            {viewMode === 'cards' ? (
              <>
                <div className="printer-card-list" aria-label="Printer result cards">
                  {pagedPrinters.map((printer) => (
                    <PrinterRecordCard key={printer.id} printer={printer} />
                  ))}
                </div>
                <div className="printer-pagination">
                  <button
                    className="compact-toggle"
                    disabled={clampedPage === 0}
                    type="button"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    Previous
                  </button>
                  <span>{`Page ${clampedPage + 1} of ${totalPages}`}</span>
                  <button
                    className="compact-toggle"
                    disabled={clampedPage >= totalPages - 1}
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <div className="data-table-wrap printers-table-wrap">
                <table className="data-table printers-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>IP / Port</th>
                      <th>Status</th>
                      <th>Location</th>
                      <th>Driver</th>
                      <th>Share</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPrinters.map((printer) => (
                      <tr key={printer.id}>
                        <td>{printer.name}</td>
                        <td>{printer.ipAddress || '—'}</td>
                        <td>{printer.status || '—'}</td>
                        <td>{printer.location || '—'}</td>
                        <td>{printer.driver || '—'}</td>
                        <td>{printer.shareName || '—'}</td>
                        <td>{printer.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title={dataset.fileName ? 'No printers match that search.' : 'No printer data loaded.'}
            description={dataset.fileName ? 'Try a printer name, share name, or IP address.' : 'Upload PrintersLAH.csv as an admin to populate this module.'}
          />
        )}
      </Card>

      <div className="printers-summary-grid">
        <Card>
          <CardHeader eyebrow="Statuses" title="Printer Status" />
          <div className="printer-chip-list">
            {statusCounts.length ? statusCounts.map((item) => (
              <span className="printer-chip" key={item.status}>
                <strong>{item.status}</strong>
                <small>{item.count.toLocaleString()}</small>
              </span>
            )) : <span className="status-text">No status data loaded.</span>}
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="Locations" title="Top Locations" />
          <div className="printer-chip-list">
            {topLocations.length ? topLocations.map((item) => (
              <span className="printer-chip" key={item.location}>
                <strong>{item.location}</strong>
                <small>{item.count.toLocaleString()}</small>
              </span>
            )) : <span className="status-text">No location data loaded.</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function HardwareEntityWorkspace() {
  const SEARCH_KEYPRESS_DELAY_MS = 220;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [loadingSourceConfig, setLoadingSourceConfig] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [rmrQuery, setRmrQuery] = useState('');
  const [debouncedRmrQuery, setDebouncedRmrQuery] = useState('');
  const [rmrSearching, setRmrSearching] = useState(false);
  const [rmrError, setRmrError] = useState('');
  const [rmrSearchColumn, setRmrSearchColumn] = useState('');
  const [rmrResults, setRmrResults] = useState([]);
  const [hasRmrSearched, setHasRmrSearched] = useState(false);
  useEffect(() => {
    let isMounted = true;
    setLoadingSourceConfig(true);
    setSearchError('');

    getDeviceLocationSource()
      .then((configPayload) => {
        if (!isMounted) {
          return;
        }

        const configuredKey = String(configPayload?.source_key || '').trim();
        setSelectedSourceKey(configuredKey);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setSearchError(error.message || 'Hardware lookup source could not be loaded.');
      })
      .finally(() => {
        if (isMounted) {
          setLoadingSourceConfig(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const queryParam = String(searchParams.get('query') || '').trim();
    const deviceParam = String(searchParams.get('device') || searchParams.get('pc') || '').trim();
    const activeParam = deviceParam || queryParam;
    if (!activeParam) {
      return;
    }
    setQuery((current) => (current === activeParam ? current : activeParam));
    setHasSearched(false);
    if (isLikelyPcName(activeParam)) {
      setRmrQuery((current) => (current === activeParam ? current : activeParam));
      setHasRmrSearched(false);
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(String(query || ''));
    }, SEARCH_KEYPRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRmrQuery(String(rmrQuery || ''));
    }, SEARCH_KEYPRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [rmrQuery]);

  useEffect(() => {
    if (!shouldRunHardwareLookup(debouncedQuery) || !selectedSourceKey || searching) {
      return;
    }
    void runSearch(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, selectedSourceKey]);

  useEffect(() => {
    if (!debouncedRmrQuery || rmrSearching) {
      return;
    }
    void runRmrSearch(debouncedRmrQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedRmrQuery]);

  async function runSearch(queryOverride = '') {
    const normalizedQuery = String(queryOverride || query || '').trim();
    if (!normalizedQuery) {
      setResults([]);
      setTickets([]);
      setHasSearched(false);
      setSearchError('');
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      const payload = await searchDeviceLocations({
        query: normalizedQuery,
        sourceKey: selectedSourceKey,
      });
      const items = Array.isArray(payload?.results) ? payload.results : [];
      const matchedTickets = Array.isArray(payload?.tickets) ? payload.tickets : [];
      setResults(items);
      setTickets(matchedTickets);
      setHasSearched(true);
    } catch (error) {
      setResults([]);
      setTickets([]);
      setHasSearched(true);
      setSearchError(error.message || 'Device location search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function runRmrSearch(queryOverride = '') {
    const normalizedQuery = String(queryOverride || rmrQuery || '').trim();
    if (!normalizedQuery) {
      setRmrResults([]);
      setRmrSearchColumn('');
      setHasRmrSearched(false);
      setRmrError('');
      return;
    }

    setRmrSearching(true);
    setRmrError('');
    try {
      const payload = await searchHardwareRmrByPcName(normalizedQuery);
      setRmrResults(Array.isArray(payload?.results) ? payload.results : []);
      setRmrSearchColumn(String(payload?.search_column || '').trim());
      setHasRmrSearched(true);
    } catch (error) {
      setRmrResults([]);
      setRmrSearchColumn('');
      setHasRmrSearched(true);
      setRmrError(error.message || 'Hardware (RMR) search failed.');
    } finally {
      setRmrSearching(false);
    }
  }

  function firstValue(row, keys = []) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return '—';
  }

  function openHardwareRmrRecord(row) {
    if (!row || typeof row !== 'object') {
      return;
    }
    const deviceName = firstValue(row, [rmrSearchColumn, 'name', 'device_name', 'computer_name']);
    const label = deviceName;
    navigate('/app/work/hardware/rmr-record', {
      state: {
        row,
        label,
        context: {
          device: deviceName !== '—' ? deviceName : '',
          origin: 'Hardware (RMR) Search',
        },
      },
    });
  }

  function resolveTicketId(row) {
    const candidates = ['ticket', 'number', 'ticket_number', 'id', 'sys_id', 'u_task_1'];
    for (const key of candidates) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return '';
  }

  function openTicketRecord(row) {
    const ticketId = resolveTicketId(row);
    if (!ticketId) {
      return;
    }
    const sourceSuffix = selectedSourceKey ? `?source=${encodeURIComponent(selectedSourceKey)}` : '';
    navigate(`/tickets/${encodeURIComponent(ticketId)}${sourceSuffix}`, {
      state: {
        from: '/app/work/hardware',
        label: 'Hardware Lookup',
        sourceKey: selectedSourceKey || '',
      },
    });
  }

  return (
    <Card className="hardware-workspace-card">
      <CardHeader
        eyebrow="Hardware"
        title="Device Location Agent"
        description="Search tickets by PC name (LAHL/LAHD) or room number."
      />

      <label className="settings-field">
        <span>Search by PC or room</span>
        <p className="status-text">Searches the configured hardware ticket source.</p>
      </label>

      <label className="settings-field">
        <span>Hardware (RMR) PC Name Search</span>
        <div className="table-actions">
          <input
            type="text"
            value={rmrQuery}
            onChange={(event) => setRmrQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setTimeout(() => {
                  void runRmrSearch();
                }, SEARCH_KEYPRESS_DELAY_MS);
              }
            }}
            placeholder="Example: LAHL or LAHD5HXPRY3"
          />
          <button type="button" className="ui-button ui-button--secondary" onClick={() => void runRmrSearch()} disabled={rmrSearching}>
            {rmrSearching ? 'Searching...' : 'Search Hardware (RMR)'}
          </button>
        </div>
      </label>

      <p className="status-text">
        {rmrSearchColumn ? `Search key column detected: ${rmrSearchColumn}` : 'Search key column will be auto-detected from LAHL/LAHD-style values.'}
      </p>
      {rmrError ? <p className="status-text status-text--error">{rmrError}</p> : null}
      {hasRmrSearched && !rmrResults.length && !rmrError ? (
        <EmptyState title="No hardware matches" description="No hardware_(rmr) rows matched that PC name search." />
      ) : null}

      {rmrResults.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>PC Name</th>
                <th>Asset Tag</th>
                <th>Assigned To</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rmrResults.map((row, index) => (
                <tr
                  key={`rmr-${index}`}
                  className="data-table__row"
                  role="button"
                  tabIndex={0}
                  onClick={() => openHardwareRmrRecord(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openHardwareRmrRecord(row);
                    }
                  }}
                  title="Open hardware record"
                >
                  <td>{firstValue(row, [rmrSearchColumn, 'name', 'device_name', 'computer_name'])}</td>
                  <td>{firstValue(row, ['asset_tag', 'u_hardware_1.asset_tag'])}</td>
                  <td>{firstValue(row, ['assigned_to', 'u_hardware_1.assigned_to'])}</td>
                  <td>{firstValue(row, ['location', 'u_hardware_1.location'])}</td>
                  <td>{firstValue(row, ['install_status', 'status', 'u_hardware_1.install_status'])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <label className="settings-field">
        <span>Lookup query</span>
        <div className="table-actions">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setTimeout(() => {
                  void runSearch();
                }, SEARCH_KEYPRESS_DELAY_MS);
              }
            }}
            placeholder="Example: LAHD12345 or 376"
          />
          <button type="button" className="ui-button ui-button--primary" onClick={() => void runSearch()} disabled={searching || loadingSourceConfig || !selectedSourceKey}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </label>

      <p className="status-text">
        {loadingSourceConfig
          ? 'Loading lookup source...'
          : `Using source: ${selectedSourceKey || 'Not configured'}`}
      </p>
      {searchError ? <p className="status-text status-text--error">{searchError}</p> : null}

      {!hasSearched ? <p className="status-text">Enter a PC name (`LAH...`) or room number, then search.</p> : null}
      {hasSearched && !tickets.length && !searchError ? <EmptyState title="No matches" description="No tickets mentioned this device or room in the selected source." /> : null}

      {tickets.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Short Description</th>
                <th>Notes</th>
                <th>Opened At</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((row, index) => (
                <tr
                  key={`${row?.ticket || row?.number || row?.id || 'ticket'}-${index}`}
                  className="data-table__row"
                  role="button"
                  tabIndex={0}
                  onClick={() => openTicketRecord(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openTicketRecord(row);
                    }
                  }}
                  title="Open ticket record"
                >
                  <td>{String(row?.ticket || row?.number || row?.id || '—')}</td>
                  <td>{String(row?.short_description || row?.['u_task_1.short_description'] || '—')}</td>
                  <td>{String(row?.comments_and_work_notes || row?.['u_task_1.comments_and_work_notes'] || '—')}</td>
                  <td>{formatTimestamp(row?.opened_at || row?.sys_created_on || row?.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

    </Card>
  );
}

export function WorkDomainPage({ domain = 'users' }) {
  const location = useLocation();
  const config = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG.users;

  return (
    <section className="module">
      {domain !== 'software' ? (
        <SectionHeader
          tag={`/app/work/${domain}`}
          title={config.title}
          description={config.description}
        />
      ) : null}

      {domain === 'users'
        ? <UsersEntityWorkspace />
        : domain === 'printers'
          ? <PrintersEntityWorkspace />
        : domain === 'hardware'
          ? <HardwareEntityWorkspace />
        : domain === 'software'
          ? <SoftwareRegistryPage embedded headerTag="/app/work/software" />
          : <PlaceholderEntityWorkspace label={config.title} />}

      <ModuleCard title="Navigation" collapsible defaultCollapsed>
        <Link className="compact-toggle" to="/app/work" state={{ from: location.pathname, label: `${config.title} Domain` }}>
          Return to Work Hub
        </Link>
      </ModuleCard>
    </section>
  );
}

export default WorkDomainPage;
