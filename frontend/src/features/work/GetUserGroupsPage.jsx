import {
  Activity,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Info,
  MapPin,
  Network,
  Pencil,
  RefreshCcw,
  Search,
  Ticket,
  Upload,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { STORAGE_KEYS } from '../../app/constants/storageKeys';
import { getDataSources, getLatestTickets, getUploadFile, getUploads, getUserGroups, replaceDataSourceFile, searchUsersPeopleSoftBackup } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { storage } from '../../app/utils/storage';
import { parseCsvText } from './workDatasetCache';
import {
  getCachedUsersFromMap,
  normalizeFlowMembershipResponse,
  readUserGroupsCacheMap,
  upsertCachedUserRecord,
  writeUserGroupsCacheMap,
} from './userGroupsCache';

let HARDWARE_DATASET_CACHE = null;
let HARDWARE_DATASET_PROMISE = null;
let TICKETS_DATASET_CACHE = null;
let TICKETS_DATASET_PROMISE = null;

const HARDWARE_MATCH_FALLBACK_COLUMNS = [
  'u_hardware_1.assigned_to',
  'assigned_to',
  'assignedto',
  'assignee',
  'assigned',
];

const TICKETS_MATCH_FALLBACK_COLUMNS = [
  'u_impacted_user',
  'impacted_user',
  'caller_id',
  'u_task_1.u_impacted_user',
];

const USER_DIRECTORY_FIELDS = [
  { key: 'opid', label: 'OPID' },
  { key: 'display_name', label: 'Name' },
  { key: 'email', label: 'Email' },
];

const DEFAULT_SEARCH_SETTINGS = {
  cachedUsersEnabled: true,
  cachedUserFields: USER_DIRECTORY_FIELDS.map((field) => field.key),
  hardwareEnabled: true,
  hardwareColumns: [],
  ticketsEnabled: true,
  ticketColumns: [],
};

const PEOPLESOFT_BACKUP_SOURCE_NAME = 'u_users__peoplesoft_locations';

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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function formatColumnLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Unknown Column';
  }
  return text
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readFirst(row, keys) {
  for (const key of keys) {
    const value = String(row?.[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeHardwareRow(row) {
  const assignedTo = readFirst(row, ['u_hardware_1.assigned_to', 'assigned_to', 'assignedto', 'assignee', 'assigned']);
  const assetTag = readFirst(row, ['u_hardware_1.asset_tag', 'asset_tag', 'assettag']);
  const serial = readFirst(row, ['u_hardware_1.serial_number', 'serial_number', 'serial']);
  const ip = readFirst(row, ['u_hardware_1.ip_address', 'ip_address', 'ip']);
  const status = readFirst(row, ['u_hardware_1.install_status', 'install_status', 'status']);
  const location = readFirst(row, ['u_hardware_1.location', 'location', 'site']);
  const type = readFirst(row, ['u_hardware_1.model_category', 'model_category', 'type', 'category', 'class']);
  const deviceName = readFirst(row, ['u_hardware_1.name', 'name', 'display_name', 'ci_name', 'computer_name']) || serial || assetTag || 'Unknown device';

  return {
    id: assetTag || serial || deviceName,
    deviceName,
    type: type || 'Hardware',
    assignedTo,
    assetTag,
    ip,
    status: status || 'Unknown',
    location: location || 'Unknown',
  };
}

function normalizeTicketRow(row) {
  return {
    number: readFirst(row, ['number', 'u_task_1', 'ticket', 'incident']),
    shortDescription: readFirst(row, ['short_description', 'u_task_1.short_description']),
    impactedUser: readFirst(row, ['u_impacted_user', 'impacted_user', 'caller_id', 'u_task_1.u_impacted_user']),
    createdAt: readFirst(row, ['opened_at', 'sys_created_on', 'created_on', 'u_task_1.sys_created_on']),
  };
}

function hasValidHardwareFilename(file) {
  const name = String(file?.filename || '').toLowerCase();
  return name.includes('hardware') && name.endsWith('.csv');
}

async function loadHardwareDataset() {
  if (HARDWARE_DATASET_CACHE) {
    return HARDWARE_DATASET_CACHE;
  }
  if (HARDWARE_DATASET_PROMISE) {
    return HARDWARE_DATASET_PROMISE;
  }

  HARDWARE_DATASET_PROMISE = (async () => {
    const uploads = await getUploads();
    const files = Array.isArray(uploads) ? uploads : [];
    const candidates = files
      .filter(hasValidHardwareFilename)
      .sort((left, right) => (Date.parse(right?.modifiedAt || '') || 0) - (Date.parse(left?.modifiedAt || '') || 0));

    const selected = candidates[0];
    if (!selected?.url) {
      HARDWARE_DATASET_CACHE = { rows: [], fileName: '', modifiedAt: '' };
      return HARDWARE_DATASET_CACHE;
    }

    const csvText = await getUploadFile(selected.url);
    const parsed = parseCsvText(csvText);
    HARDWARE_DATASET_CACHE = {
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
      fileName: String(selected.filename || ''),
      modifiedAt: String(selected.modifiedAt || ''),
    };
    return HARDWARE_DATASET_CACHE;
  })();

  try {
    return await HARDWARE_DATASET_PROMISE;
  } finally {
    HARDWARE_DATASET_PROMISE = null;
  }
}

async function loadTicketsDataset() {
  if (TICKETS_DATASET_CACHE) {
    return TICKETS_DATASET_CACHE;
  }
  if (TICKETS_DATASET_PROMISE) {
    return TICKETS_DATASET_PROMISE;
  }

  TICKETS_DATASET_PROMISE = (async () => {
    const payload = await getLatestTickets();
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const rows = Array.isArray(data?.tickets) ? data.tickets : [];
    TICKETS_DATASET_CACHE = {
      rows,
      fileName: String(data?.fileName || ''),
      modifiedAt: String(data?.lastUpdated || ''),
    };
    return TICKETS_DATASET_CACHE;
  })();

  try {
    return await TICKETS_DATASET_PROMISE;
  } finally {
    TICKETS_DATASET_PROMISE = null;
  }
}

function inferDatasetColumns(rows = []) {
  const unique = new Set();
  const sample = Array.isArray(rows) ? rows.slice(0, 75) : [];
  sample.forEach((row) => {
    if (!row || typeof row !== 'object') {
      return;
    }
    Object.keys(row).forEach((key) => {
      const normalized = String(key || '').trim();
      if (normalized) {
        unique.add(normalized);
      }
    });
  });
  return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

function sanitizeColumns(preferred = [], available = [], fallback = []) {
  const availableSet = new Set(available);
  const preferredMatches = (Array.isArray(preferred) ? preferred : [])
    .map((item) => String(item || '').trim())
    .filter((item, index, source) => item && source.indexOf(item) === index && availableSet.has(item));
  if (preferredMatches.length) {
    return preferredMatches;
  }
  const fallbackMatches = fallback.filter((item) => availableSet.has(item));
  if (fallbackMatches.length) {
    return fallbackMatches;
  }
  return [];
}

function sanitizeSearchSettings(settings = {}, hardwareColumns = [], ticketColumns = []) {
  const next = {
    ...DEFAULT_SEARCH_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {}),
  };
  const cachedUserFields = USER_DIRECTORY_FIELDS
    .map((field) => field.key)
    .filter((fieldKey) => Array.isArray(next.cachedUserFields) && next.cachedUserFields.includes(fieldKey));

  return {
    cachedUsersEnabled: next.cachedUsersEnabled !== false,
    cachedUserFields: cachedUserFields.length ? cachedUserFields : DEFAULT_SEARCH_SETTINGS.cachedUserFields,
    hardwareEnabled: next.hardwareEnabled !== false,
    hardwareColumns: sanitizeColumns(next.hardwareColumns, hardwareColumns, HARDWARE_MATCH_FALLBACK_COLUMNS),
    ticketsEnabled: next.ticketsEnabled !== false,
    ticketColumns: sanitizeColumns(next.ticketColumns, ticketColumns, TICKETS_MATCH_FALLBACK_COLUMNS),
  };
}

function getSelectedUserSearchTerms(selectedUser, fallbackQuery = '') {
  const terms = [
    selectedUser?.opid,
    selectedUser?.display_name,
    selectedUser?.email,
    fallbackQuery,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(terms));
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
    job_title: String(user?.job_title || '').trim() || null,
    department: String(user?.department || '').trim() || null,
    location: String(user?.location || '').trim() || null,
    account_enabled: user?.account_enabled ?? null,
    groups: [],
    cached_at: new Date().toISOString(),
    source: String(user?.source || 'u_users__peoplesoft_locations').trim() || 'u_users__peoplesoft_locations',
  };
}

function getSingleSearchMatch(items = [], query = '') {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (normalizedItems.length === 1) {
    return normalizedItems[0];
  }

  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return null;
  }

  const exactMatches = normalizedItems.filter((item) => {
    const normalized = normalizeSourceUser(item);
    if (!normalized) {
      return false;
    }
    return [normalized.opid, normalized.display_name, normalized.email]
      .map(normalizeText)
      .filter(Boolean)
      .some((value) => value === normalizedQuery);
  });

  return exactMatches.length === 1 ? exactMatches[0] : null;
}

function rowMatchesSearchTerms(row, columns = [], terms = []) {
  if (!row || typeof row !== 'object' || !columns.length || !terms.length) {
    return false;
  }

  const normalizedTerms = terms.map(normalizeText).filter(Boolean);
  if (!normalizedTerms.length) {
    return false;
  }

  return columns.some((column) => {
    const value = normalizeText(row?.[column]);
    if (!value) {
      return false;
    }
    return normalizedTerms.some((term) => value.includes(term));
  });
}

export function GetUserGroupsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const goBack = useBackNavigation('/app/work');
  const backLabel = location.state?.label || 'Work Hub';
  const autoSearchQuery = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('query') || '').trim();
  }, [location.search]);
  const autoLookupMode = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('lookup') || '').trim().toLowerCase();
  }, [location.search]);

  const [userOpid, setUserOpid] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [activeTab, setActiveTab] = useState('groups');
  const [autoSearchedQuery, setAutoSearchedQuery] = useState('');
  const [searchSettingsOpen, setSearchSettingsOpen] = useState(false);
  const [backupSourceName, setBackupSourceName] = useState('');
  const [backupMatches, setBackupMatches] = useState([]);
  const [backupLookupLoading, setBackupLookupLoading] = useState(false);
  const [peopleSoftSource, setPeopleSoftSource] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [replacementFile, setReplacementFile] = useState(null);
  const [replacingSourceFile, setReplacingSourceFile] = useState(false);
  const [searchSettings, setSearchSettings] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.USER_CONTEXT_SEARCH_SETTINGS);
    return { ...DEFAULT_SEARCH_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  });

  const [cache, setCache] = useState({});
  const [selectedOpid, setSelectedOpid] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [hardwareLoading, setHardwareLoading] = useState(false);
  const [hardwareError, setHardwareError] = useState('');
  const [hardwareDataset, setHardwareDataset] = useState({ rows: [], fileName: '', modifiedAt: '' });

  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketsDataset, setTicketsDataset] = useState({ rows: [], fileName: '', modifiedAt: '' });

  const hardwareColumns = useMemo(() => inferDatasetColumns(hardwareDataset?.rows), [hardwareDataset?.rows]);
  const ticketColumns = useMemo(() => inferDatasetColumns(ticketsDataset?.rows), [ticketsDataset?.rows]);

  useEffect(() => {
    setSearchSettings((current) => {
      const sanitized = sanitizeSearchSettings(current, hardwareColumns, ticketColumns);
      if (JSON.stringify(current) === JSON.stringify(sanitized)) {
        return current;
      }
      return sanitized;
    });
  }, [hardwareColumns, ticketColumns]);

  useEffect(() => {
    storage.set(STORAGE_KEYS.USER_CONTEXT_SEARCH_SETTINGS, searchSettings);
  }, [searchSettings]);

  useEffect(() => {
    const nextCache = readUserGroupsCacheMap();
    const normalizedUsers = getCachedUsersFromMap(nextCache);
    setCache(nextCache);
    setSelectedOpid(normalizedUsers[0]?.opid || '');
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    let mounted = true;
    setSourceLoading(true);
    setSourceError('');
    getDataSources()
      .then((payload) => {
        if (!mounted) {
          return;
        }
        const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        const source = items.find((item) => {
          const candidates = [
            item?.key,
            item?.name,
            item?.table_name,
            item?.display_name,
            item?.role,
          ].map((value) => String(value || '').trim().toLowerCase());
          return candidates.includes(PEOPLESOFT_BACKUP_SOURCE_NAME);
        }) || null;
        setPeopleSoftSource(source);
      })
      .catch((requestError) => {
        if (mounted) {
          setSourceError(requestError.message || 'PeopleSoft source metadata could not be loaded.');
        }
      })
      .finally(() => {
        if (mounted) {
          setSourceLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    let mounted = true;
    setHardwareLoading(true);
    setHardwareError('');
    loadHardwareDataset()
      .then((dataset) => {
        if (mounted) {
          setHardwareDataset(dataset || { rows: [], fileName: '', modifiedAt: '' });
        }
      })
      .catch((requestError) => {
        if (mounted) {
          setHardwareError(requestError.message || 'Hardware dataset could not be loaded.');
        }
      })
      .finally(() => {
        if (mounted) {
          setHardwareLoading(false);
        }
      });

    setTicketsLoading(true);
    setTicketsError('');
    loadTicketsDataset()
      .then((dataset) => {
        if (mounted) {
          setTicketsDataset(dataset || { rows: [], fileName: '', modifiedAt: '' });
        }
      })
      .catch((requestError) => {
        if (mounted) {
          setTicketsError(requestError.message || 'Active tickets dataset could not be loaded.');
        }
      })
      .finally(() => {
        if (mounted) {
          setTicketsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const cachedUsers = useMemo(() => getCachedUsersFromMap(cache), [cache]);

  const filteredUsers = useMemo(() => {
    const query = normalizeText(userSearch);
    if (!query || !searchSettings.cachedUsersEnabled) {
      return cachedUsers;
    }
    return cachedUsers.filter((item) => {
      return searchSettings.cachedUserFields.some((field) => normalizeText(item?.[field]).includes(query));
    });
  }, [cachedUsers, searchSettings.cachedUserFields, searchSettings.cachedUsersEnabled, userSearch]);

  const selectedUser = useMemo(
    () => (selectedOpid ? cachedUsers.find((item) => item.opid === selectedOpid) || null : null),
    [cachedUsers, selectedOpid]
  );

  const filteredGroups = useMemo(() => {
    const groups = Array.isArray(selectedUser?.groups) ? selectedUser.groups : [];
    const query = normalizeText(groupQuery);
    const visible = groups.filter((group) => {
      const id = String(group?.group_id || '').trim();
      if (!id || id.includes('$metadata') || id.startsWith('https://graph.microsoft.com')) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [group?.name, group?.group_id].some((value) => normalizeText(value).includes(query));
    });
    return visible.sort((left, right) => String(left?.name || left?.group_id).localeCompare(String(right?.name || right?.group_id)));
  }, [groupQuery, selectedUser]);

  const activeSearchTerms = useMemo(
    () => getSelectedUserSearchTerms(selectedUser, userSearch || userOpid || autoSearchQuery),
    [autoSearchQuery, selectedUser, userOpid, userSearch]
  );

  const userDevices = useMemo(() => {
    const rows = Array.isArray(hardwareDataset?.rows) ? hardwareDataset.rows : [];
    if (!searchSettings.hardwareEnabled || !activeSearchTerms.length) {
      return [];
    }
    return rows
      .filter((row) => rowMatchesSearchTerms(row, searchSettings.hardwareColumns, activeSearchTerms))
      .map(normalizeHardwareRow);
  }, [activeSearchTerms, hardwareDataset?.rows, searchSettings.hardwareColumns, searchSettings.hardwareEnabled]);

  const userTickets = useMemo(() => {
    const rows = Array.isArray(ticketsDataset?.rows) ? ticketsDataset.rows : [];
    if (!searchSettings.ticketsEnabled || !activeSearchTerms.length) {
      return [];
    }
    return rows
      .filter((row) => rowMatchesSearchTerms(row, searchSettings.ticketColumns, activeSearchTerms))
      .map(normalizeTicketRow)
      .filter((ticket) => ticket.number || ticket.shortDescription);
  }, [activeSearchTerms, searchSettings.ticketColumns, searchSettings.ticketsEnabled, ticketsDataset?.rows]);

  const resolvedLocation =
    String(selectedUser?.location || '').trim()
    || String(userDevices[0]?.location || '').trim()
    || 'Unknown';

  const activityItems = useMemo(() => {
    if (!selectedUser) {
      return [];
    }

    return [
      {
        label: 'Cached At',
        value: formatTimestamp(selectedUser.cached_at),
      },
      {
        label: 'Groups Retrieved',
        value: String(selectedUser.total_count || filteredGroups.length || 0),
      },
      {
        label: 'Hardware Source',
        value: hardwareDataset.fileName ? `${hardwareDataset.fileName} (${formatTimestamp(hardwareDataset.modifiedAt)})` : 'Unavailable',
      },
      {
        label: 'Tickets Source',
        value: ticketsDataset.fileName ? `${ticketsDataset.fileName} (${formatTimestamp(ticketsDataset.modifiedAt)})` : 'Unavailable',
      },
    ];
  }, [filteredGroups.length, hardwareDataset.fileName, hardwareDataset.modifiedAt, selectedUser, ticketsDataset.fileName, ticketsDataset.modifiedAt]);

  async function loadUserGroups(normalizedOpid, forceRefresh = false) {
    if (!normalizedOpid) {
      setError('Enter a user OPID before running the lookup.');
      return;
    }

    if (!forceRefresh && cache[normalizedOpid]) {
      setSelectedOpid(normalizedOpid);
      setError('');
      setMessage('');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await getUserGroups(normalizedOpid);
      const normalized = normalizeFlowMembershipResponse(response, normalizedOpid);
      const nextCache = upsertCachedUserRecord(normalized, cache);
      setCache(nextCache);
      writeUserGroupsCacheMap(nextCache);
      setSelectedOpid(normalizedOpid);
    } catch (requestError) {
      setError(requestError.message || 'User group lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  function addResolvedUserToCache(user) {
    const normalized = normalizeSourceUser(user);
    if (!normalized?.opid) {
      return null;
    }
    const nextCache = upsertCachedUserRecord(normalized, cache);
    setCache(nextCache);
    writeUserGroupsCacheMap(nextCache);
    setSelectedOpid(normalized.opid);
    return normalized;
  }

  async function runPeopleSoftAutoLookup(query) {
    const normalizedQuery = String(query || '').trim();
    if (normalizedQuery.length < 2) {
      return;
    }

    setBackupLookupLoading(true);
    setError('');
    try {
      const payload = await searchUsersPeopleSoftBackup(normalizedQuery, { limit: 20 });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setBackupSourceName(String(payload?.source_name || '').trim());
      setBackupMatches(items);
      const singleMatch = getSingleSearchMatch(items, normalizedQuery);
      if (!singleMatch) {
        setError(items.length ? 'Multiple PeopleSoft matches found. Select the correct user below.' : 'No PeopleSoft match found for the auto-filled user.');
        return;
      }

      const resolved = addResolvedUserToCache(singleMatch);
      if (resolved?.opid) {
        setUserOpid(resolved.opid);
        setUserSearch(resolved.display_name || resolved.email || resolved.opid);
        setBackupMatches([]);
        await loadUserGroups(resolved.opid, false);
      }
    } catch (requestError) {
      setBackupMatches([]);
      setError(requestError.message || 'PeopleSoft backup lookup failed.');
    } finally {
      setBackupLookupLoading(false);
    }
  }

  useEffect(() => {
    if (!autoSearchQuery || autoSearchedQuery === autoSearchQuery) {
      return;
    }

    setUserOpid(autoSearchQuery);
    setUserSearch(autoSearchQuery);
    setAutoSearchedQuery(autoSearchQuery);
    if (autoLookupMode === 'peoplesoft') {
      void runPeopleSoftAutoLookup(autoSearchQuery);
      return;
    }
    void loadUserGroups(autoSearchQuery, false);
  }, [autoLookupMode, autoSearchQuery, autoSearchedQuery, cache]);

  async function handleSubmit(event) {
    event.preventDefault();
    await loadUserGroups(userOpid.trim(), false);
  }

  async function handleRefresh() {
    await loadUserGroups((selectedOpid || userOpid).trim(), true);
  }

  async function handleReplacePeopleSoftSource() {
    const sourceId = Number(peopleSoftSource?.id || 0);
    if (!sourceId) {
      setError('PeopleSoft backup data source was not found.');
      return;
    }
    if (!(replacementFile instanceof File)) {
      setError('Choose a CSV file before uploading.');
      return;
    }

    setReplacingSourceFile(true);
    setError('');
    setMessage('');
    try {
      const payload = await replaceDataSourceFile(sourceId, replacementFile, { type: 'csv' });
      setPeopleSoftSource(payload?.source || peopleSoftSource);
      setReplacementFile(null);
      setMessage('PeopleSoft backup source file uploaded and activated.');
      setBackupSourceName(String(payload?.source?.key || payload?.source?.name || PEOPLESOFT_BACKUP_SOURCE_NAME).trim());
    } catch (requestError) {
      setError(requestError.message || 'PeopleSoft source upload failed.');
    } finally {
      setReplacingSourceFile(false);
    }
  }

  async function handleSelectBackupMatch(match) {
    const resolved = addResolvedUserToCache(match);
    if (!resolved?.opid) {
      setError('Selected backup match could not be resolved to an OPID.');
      return;
    }

    setError('');
    setMessage('');
    setUserOpid(resolved.opid);
    setUserSearch(resolved.display_name || resolved.email || resolved.opid);
    setBackupMatches([]);
    await loadUserGroups(resolved.opid, false);
  }

  function toggleCachedUserField(fieldKey) {
    setSearchSettings((current) => {
      const currentFields = Array.isArray(current.cachedUserFields) ? current.cachedUserFields : [];
      const nextFields = currentFields.includes(fieldKey)
        ? currentFields.filter((item) => item !== fieldKey)
        : [...currentFields, fieldKey];
      return {
        ...current,
        cachedUserFields: nextFields,
      };
    });
  }

  function toggleSearchSettingBoolean(key) {
    setSearchSettings((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleDatasetColumn(key, column) {
    setSearchSettings((current) => {
      const currentColumns = Array.isArray(current[key]) ? current[key] : [];
      const nextColumns = currentColumns.includes(column)
        ? currentColumns.filter((item) => item !== column)
        : [...currentColumns, column];
      return {
        ...current,
        [key]: nextColumns,
      };
    });
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/work/user-context"
        title="User Context"
        description="Operational view of identity, groups, devices, and active tickets."
        actions={
          <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
            {`Back to ${backLabel}`}
          </button>
        }
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {message ? <p className="status-text">{message}</p> : null}

      <div className="user-context-layout">
        <aside className="user-context-col user-context-col--left">
          <Card>
            <CardHeader eyebrow="Search" title="Users" />
            {autoSearchQuery ? (
              <div className="user-context-auto-search">
                <div className="user-context-auto-search__header">
                  <div>
                    <strong>Auto-filled user search</strong>
                    <p>{autoSearchQuery}</p>
                  </div>
                  <button
                    type="button"
                    className="compact-toggle compact-toggle--icon"
                    aria-expanded={searchSettingsOpen}
                    onClick={() => setSearchSettingsOpen((current) => !current)}
                    title="Edit auto-search settings"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                <p className="user-context-auto-search__summary">
                  {[
                    searchSettings.cachedUsersEnabled ? `Users: ${searchSettings.cachedUserFields.length || 0} fields` : 'Users: off',
                    searchSettings.hardwareEnabled ? `Hardware: ${searchSettings.hardwareColumns.length || 0} columns` : 'Hardware: off',
                    searchSettings.ticketsEnabled ? `Tickets: ${searchSettings.ticketColumns.length || 0} columns` : 'Tickets: off',
                  ].join(' • ')}
                </p>

                {searchSettingsOpen ? (
                  <div className="user-context-search-settings">
                    <div className="user-context-search-settings__group">
                      <button
                        type="button"
                        className={searchSettings.cachedUsersEnabled ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                        onClick={() => toggleSearchSettingBoolean('cachedUsersEnabled')}
                      >
                        {searchSettings.cachedUsersEnabled ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Search cached users
                      </button>
                      <div className="user-context-search-settings__options">
                        {USER_DIRECTORY_FIELDS.map((field) => (
                          <label className="user-context-search-settings__option" key={field.key}>
                            <input
                              type="checkbox"
                              checked={searchSettings.cachedUserFields.includes(field.key)}
                              onChange={() => toggleCachedUserField(field.key)}
                            />
                            <span>{field.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="user-context-search-settings__group">
                      <button
                        type="button"
                        className={searchSettings.hardwareEnabled ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                        onClick={() => toggleSearchSettingBoolean('hardwareEnabled')}
                      >
                        {searchSettings.hardwareEnabled ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Search hardware dataset
                      </button>
                      <div className="user-context-search-settings__options">
                        {hardwareColumns.length ? hardwareColumns.map((column) => (
                          <label className="user-context-search-settings__option" key={column}>
                            <input
                              type="checkbox"
                              checked={searchSettings.hardwareColumns.includes(column)}
                              onChange={() => toggleDatasetColumn('hardwareColumns', column)}
                            />
                            <span>{formatColumnLabel(column)}</span>
                            <small>{column}</small>
                          </label>
                        )) : <p className="status-text">Hardware columns load after the dataset finishes loading.</p>}
                      </div>
                    </div>

                    <div className="user-context-search-settings__group">
                      <button
                        type="button"
                        className={searchSettings.ticketsEnabled ? 'compact-toggle compact-toggle--active' : 'compact-toggle'}
                        onClick={() => toggleSearchSettingBoolean('ticketsEnabled')}
                      >
                        {searchSettings.ticketsEnabled ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Search active tickets
                      </button>
                      <div className="user-context-search-settings__options">
                        {ticketColumns.length ? ticketColumns.map((column) => (
                          <label className="user-context-search-settings__option" key={column}>
                            <input
                              type="checkbox"
                              checked={searchSettings.ticketColumns.includes(column)}
                              onChange={() => toggleDatasetColumn('ticketColumns', column)}
                            />
                            <span>{formatColumnLabel(column)}</span>
                            <small>{column}</small>
                          </label>
                        )) : <p className="status-text">Ticket columns load after the dataset finishes loading.</p>}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="user-context-source-card">
              <div className="user-context-source-card__header">
                <strong>Search Source</strong>
                <span className="icon-badge"><Info size={14} /></span>
              </div>
              <div className="association-summary user-context-card">
                <div className="association-summary__row">
                  <span>Auto Lookup</span>
                  <strong>{autoLookupMode || 'direct'}</strong>
                </div>
                <div className="association-summary__row">
                  <span>Backend source</span>
                  <strong>{backupSourceName || PEOPLESOFT_BACKUP_SOURCE_NAME}</strong>
                </div>
                <div className="association-summary__row">
                  <span>Query value</span>
                  <strong>{autoSearchQuery || userSearch || userOpid || '—'}</strong>
                </div>
                {peopleSoftSource ? (
                  <>
                    <div className="association-summary__row">
                      <span>Source key</span>
                      <strong>{peopleSoftSource.key || peopleSoftSource.name || '—'}</strong>
                    </div>
                    <div className="association-summary__row">
                      <span>Table</span>
                      <strong>{peopleSoftSource.table_name || '—'}</strong>
                    </div>
                    <div className="association-summary__row">
                      <span>Rows</span>
                      <strong>{Number(peopleSoftSource.row_count || 0)}</strong>
                    </div>
                  </>
                ) : null}
              </div>
              {sourceLoading ? <p className="status-text">Loading source metadata...</p> : null}
              {sourceError ? <p className="status-text status-text--error">{sourceError}</p> : null}
              {backupLookupLoading ? <p className="status-text">Searching PeopleSoft backup...</p> : null}
              {backupMatches.length ? (
                <div className="user-context-backup-results">
                  <p className="status-text">{`PeopleSoft matches: ${backupMatches.length}`}</p>
                  <div className="stack-list user-context-list">
                    {backupMatches.map((item, index) => {
                      const normalized = normalizeSourceUser(item);
                      if (!normalized) {
                        return null;
                      }
                      return (
                        <button
                          key={`${normalized.opid}-${index}`}
                          type="button"
                          className="stack-row stack-row--interactive"
                          onClick={() => void handleSelectBackupMatch(item)}
                        >
                          <span className="stack-row__label">
                            <span>
                              <strong>{normalized.display_name || 'Unknown User'}</strong>
                              <small>{normalized.opid}</small>
                              {normalized.email ? <small>{normalized.email}</small> : null}
                              {normalized.location ? <small>{normalized.location}</small> : null}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {isAdmin ? (
              <div className="user-context-source-upload">
                <div className="user-context-source-card__header">
                  <strong>Admin Source Upload</strong>
                  <span className="icon-badge"><Upload size={14} /></span>
                </div>
                <label className="settings-field">
                  <span>Replace PeopleSoft source CSV</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setReplacementFile(event.target.files?.[0] || null)}
                  />
                </label>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={replacingSourceFile || !peopleSoftSource || !(replacementFile instanceof File)}
                  onClick={() => void handleReplacePeopleSoftSource()}
                >
                  {replacingSourceFile ? 'Uploading...' : 'Upload Replacement CSV'}
                </button>
                <p className="status-text">
                  {peopleSoftSource
                    ? `This replaces the active file for ${peopleSoftSource.key || peopleSoftSource.name}.`
                    : `No matching ${PEOPLESOFT_BACKUP_SOURCE_NAME} data source record was found.`}
                </p>
              </div>
            ) : null}
            <form className="settings-form" onSubmit={handleSubmit}>
              <label className="settings-field">
                <span>Lookup OPID</span>
                <input
                  type="text"
                  value={userOpid}
                  onChange={(event) => setUserOpid(event.target.value)}
                  placeholder="Example: wnwd6f"
                />
              </label>
              <button type="submit" className="ui-button ui-button--primary" disabled={loading}>
                {loading ? 'Loading...' : 'Get User Groups'}
              </button>
            </form>

            <label className="settings-field user-context-search">
              <span>Filter recent users</span>
              <input
                type="text"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search OPID, name, email"
              />
            </label>

            {filteredUsers.length ? (
              <div className="stack-list user-context-list">
                  {filteredUsers.map((item) => (
                    <button
                      key={item.opid}
                    type="button"
                    className={item.opid === selectedOpid ? 'stack-row stack-row--interactive association-list__item--selected' : 'stack-row stack-row--interactive'}
                    onClick={() => setSelectedOpid(item.opid)}
                  >
                    <span className="stack-row__label">
                      <span>
                        <strong>{item.display_name || 'Unknown User'}</strong>
                        <small>{item.opid}</small>
                        {item.email ? <small>{item.email}</small> : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Users size={18} />} title="No matching cached users" description="Run the lookup above or search another OPID, name, or email." />
            )}
          </Card>
        </aside>

        <main className="user-context-col user-context-col--center">
          <Card>
            <CardHeader eyebrow="Selected User" title={selectedUser?.display_name || 'Unknown User'} action={<span className="icon-badge"><UserRound size={16} /></span>} />
            {selectedUser ? (
              <div className="dataset-metrics-grid">
                <div className="metric-tile"><span>OPID</span><strong>{selectedUser.opid}</strong></div>
                <div className="metric-tile"><span>Name</span><strong>{selectedUser.display_name || 'Unknown User'}</strong></div>
                <div className="metric-tile"><span>Department</span><strong>{String(selectedUser.department || '').trim() || 'Unknown'}</strong></div>
                <div className="metric-tile"><span>Location</span><strong>{resolvedLocation}</strong></div>
                <div className="metric-tile"><span>Device Count</span><strong>{userDevices.length}</strong></div>
                <div className="metric-tile"><span>Group Count</span><strong>{filteredGroups.length}</strong></div>
              </div>
            ) : (
              <EmptyState icon={<Search size={20} />} title="No user selected" description="Use the lookup panel to load a user, or open a ticket user from ticket details." />
            )}
          </Card>

          <Card>
            <div className="flow-detail-tabs" role="tablist" aria-label="User context tabs">
              <button type="button" className={activeTab === 'groups' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'} onClick={() => setActiveTab('groups')}>
                <Network size={14} />
                Groups
              </button>
              <button type="button" className={activeTab === 'devices' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'} onClick={() => setActiveTab('devices')}>
                <HardDrive size={14} />
                Devices
              </button>
              <button type="button" className={activeTab === 'tickets' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'} onClick={() => setActiveTab('tickets')}>
                <Ticket size={14} />
                Tickets
              </button>
              <button type="button" className={activeTab === 'activity' ? 'compact-toggle compact-toggle--active' : 'compact-toggle'} onClick={() => setActiveTab('activity')}>
                <Activity size={14} />
                Activity
              </button>
            </div>

            {activeTab === 'groups' ? (
              <div className="flow-detail-panel">
                <label className="settings-field">
                  <span>Filter groups</span>
                  <input
                    type="text"
                    value={groupQuery}
                    onChange={(event) => setGroupQuery(event.target.value)}
                    placeholder="Search by group name or id"
                    disabled={!selectedUser}
                  />
                </label>
                <div className="association-list association-list--fit">
                  {filteredGroups.length ? (
                    filteredGroups.map((group) => (
                      <div className="association-list__item" key={group.group_id}>
                        <span className="association-list__title">{group.name || group.group_id}</span>
                        <span className="association-list__meta">{group.group_id}</span>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      icon={<Search size={18} />}
                      title={selectedUser ? 'No groups found' : 'No user selected'}
                      description={selectedUser ? 'Try another filter value.' : 'Select a user to view memberships.'}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'devices' ? (
              <div className="flow-detail-panel">
                {hardwareLoading ? <p className="status-text">Loading hardware dataset...</p> : null}
                {hardwareError ? <p className="status-text status-text--error">{hardwareError}</p> : null}
                {!hardwareLoading && !hardwareError ? (
                  <div className="association-list association-list--fit">
                    {userDevices.length ? (
                      userDevices.map((device) => (
                        <div className="association-list__item" key={`${device.id}-${device.assetTag}`}>
                          <span className="association-list__title">{device.assetTag || device.deviceName}</span>
                          <span className="association-list__meta">{`IP: ${device.ip || 'n/a'} · Status: ${device.status}`}</span>
                        </div>
                      ))
                    ) : (
                      <EmptyState icon={<HardDrive size={18} />} title="No devices" description="No hardware records matched the current search settings." />
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'tickets' ? (
              <div className="flow-detail-panel">
                {ticketsLoading ? <p className="status-text">Loading tickets dataset...</p> : null}
                {ticketsError ? <p className="status-text status-text--error">{ticketsError}</p> : null}
                {!ticketsLoading && !ticketsError ? (
                  <div className="association-list association-list--fit">
                    {userTickets.length ? (
                      userTickets.map((ticket, index) => (
                        <div className="association-list__item" key={`${ticket.number}-${index}`}>
                          <span className="association-list__title">{ticket.number || 'Untitled ticket'}</span>
                          <span className="association-list__meta">{ticket.shortDescription || 'No short description'}</span>
                        </div>
                      ))
                    ) : (
                      <EmptyState icon={<Ticket size={18} />} title="No tickets" description="No active tickets matched the current search settings." />
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'activity' ? (
              <div className="flow-detail-panel">
                {activityItems.length ? (
                  <div className="association-validation__list">
                    {activityItems.map((item) => (
                      <div className="association-validation__row" key={item.label}>
                        <span>{item.label}</span>
                        <span>{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Activity size={18} />} title="No activity" description="Select a user to view context activity." />
                )}
              </div>
            ) : null}
          </Card>
        </main>

        <aside className="user-context-col user-context-col--right">
          <Card>
            <CardHeader eyebrow="Actions" title="Operational Actions" action={<span className="icon-badge"><Workflow size={16} /></span>} />
            <div className="table-actions user-context-actions">
              <button type="button" className="compact-toggle" onClick={() => void handleRefresh()} disabled={loading || (!selectedOpid && !userOpid.trim())}>
                <RefreshCcw size={14} />
                Refresh Groups
              </button>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/users')}>
                Compare Users
              </button>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/group-search')}>
                Run Flow
              </button>
              {isAdmin ? (
                <>
                  <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/users?action=add')}>
                    Add to Group
                  </button>
                  <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/users?action=remove')}>
                    Remove from Group
                  </button>
                </>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Data Sources" title="Loaded Datasets" />
            <div className="association-summary">
              <div className="association-summary__row">
                <span>Hardware</span>
                <strong>{hardwareDataset.fileName ? `${hardwareDataset.fileName}` : 'Unavailable'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Active Tickets</span>
                <strong>{ticketsDataset.fileName ? `${ticketsDataset.fileName}` : 'Unavailable'}</strong>
              </div>
              <div className="association-summary__row">
                <span>Updated</span>
                <strong>{formatTimestamp(ticketsDataset.modifiedAt || hardwareDataset.modifiedAt)}</strong>
              </div>
              <div className="association-summary__row">
                <span>Location</span>
                <strong><MapPin size={12} /> {resolvedLocation}</strong>
              </div>
              <div className="association-summary__row">
                <span>Search Scope</span>
                <strong>{[
                  searchSettings.cachedUsersEnabled ? 'Users' : null,
                  searchSettings.hardwareEnabled ? 'Hardware' : null,
                  searchSettings.ticketsEnabled ? 'Tickets' : null,
                ].filter(Boolean).join(', ') || 'None'}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}

export default GetUserGroupsPage;
