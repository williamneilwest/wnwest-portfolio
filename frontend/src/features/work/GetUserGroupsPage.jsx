import {
  Activity,
  HardDrive,
  MapPin,
  Network,
  RefreshCcw,
  Search,
  Ticket,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { getLatestTickets, getUploadFile, getUploads, getUserGroups } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
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

function matchesSelectedUser(rawValue, selectedUser) {
  const value = normalizeText(rawValue);
  if (!value || !selectedUser) {
    return false;
  }
  const candidates = [selectedUser.opid, selectedUser.display_name, selectedUser.email].map(normalizeText).filter(Boolean);
  return candidates.some((candidate) => value.includes(candidate));
}

export function GetUserGroupsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const goBack = useBackNavigation('/app/work');
  const backLabel = location.state?.label || 'Work Hub';

  const [userOpid, setUserOpid] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [activeTab, setActiveTab] = useState('groups');

  const [cache, setCache] = useState({});
  const [selectedOpid, setSelectedOpid] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [hardwareLoading, setHardwareLoading] = useState(false);
  const [hardwareError, setHardwareError] = useState('');
  const [hardwareDataset, setHardwareDataset] = useState({ rows: [], fileName: '', modifiedAt: '' });

  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketsDataset, setTicketsDataset] = useState({ rows: [], fileName: '', modifiedAt: '' });

  useEffect(() => {
    const nextCache = readUserGroupsCacheMap();
    const normalizedUsers = getCachedUsersFromMap(nextCache);
    setCache(nextCache);
    setSelectedOpid(normalizedUsers[0]?.opid || '');
  }, []);

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
    if (!query) {
      return cachedUsers;
    }
    return cachedUsers.filter((item) => {
      return [item.opid, item.display_name, item.email].some((value) => normalizeText(value).includes(query));
    });
  }, [cachedUsers, userSearch]);

  const selectedUser = useMemo(
    () => (selectedOpid ? cachedUsers.find((item) => item.opid === selectedOpid) || null : null),
    [cachedUsers, selectedOpid]
  );

  const filteredGroups = useMemo(() => {
    const groups = Array.isArray(selectedUser?.groups) ? selectedUser.groups : [];
    const query = normalizeText(groupQuery);
    const visible = groups.filter((group) => {
      const id = String(group?.id || '').trim();
      if (!id || id.includes('$metadata') || id.startsWith('https://graph.microsoft.com')) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [group?.name, group?.id].some((value) => normalizeText(value).includes(query));
    });
    return visible.sort((left, right) => String(left?.name || left?.id).localeCompare(String(right?.name || right?.id)));
  }, [groupQuery, selectedUser]);

  const userDevices = useMemo(() => {
    const rows = Array.isArray(hardwareDataset?.rows) ? hardwareDataset.rows : [];
    if (!selectedUser) {
      return [];
    }
    return rows
      .map(normalizeHardwareRow)
      .filter((device) => matchesSelectedUser(device?.assignedTo, selectedUser));
  }, [hardwareDataset?.rows, selectedUser]);

  const userTickets = useMemo(() => {
    const rows = Array.isArray(ticketsDataset?.rows) ? ticketsDataset.rows : [];
    if (!selectedUser) {
      return [];
    }
    return rows
      .map(normalizeTicketRow)
      .filter((ticket) => matchesSelectedUser(ticket.impactedUser, selectedUser))
      .filter((ticket) => ticket.number || ticket.shortDescription);
  }, [ticketsDataset?.rows, selectedUser]);

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
      return;
    }

    setLoading(true);
    setError('');
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

  async function handleSubmit(event) {
    event.preventDefault();
    await loadUserGroups(userOpid.trim(), false);
  }

  async function handleRefresh() {
    await loadUserGroups((selectedOpid || userOpid).trim(), true);
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

      <div className="user-context-layout">
        <aside className="user-context-col user-context-col--left">
          <Card>
            <CardHeader eyebrow="Search" title="Users" />
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
                        <strong>{item.display_name || item.opid}</strong>
                        <small>{item.opid}</small>
                        {item.email ? <small>{item.email}</small> : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Users size={18} />} title="No matching users" description="Run a lookup or change the filter." />
            )}
          </Card>
        </aside>

        <main className="user-context-col user-context-col--center">
          <Card>
            <CardHeader eyebrow="Selected User" title={selectedUser?.display_name || selectedUser?.opid || 'No user selected'} action={<span className="icon-badge"><UserRound size={16} /></span>} />
            {selectedUser ? (
              <div className="dataset-metrics-grid">
                <div className="metric-tile"><span>OPID</span><strong>{selectedUser.opid}</strong></div>
                <div className="metric-tile"><span>Name</span><strong>{selectedUser.display_name || 'Unknown'}</strong></div>
                <div className="metric-tile"><span>Department</span><strong>{String(selectedUser.department || '').trim() || 'Unknown'}</strong></div>
                <div className="metric-tile"><span>Location</span><strong>{resolvedLocation}</strong></div>
                <div className="metric-tile"><span>Device Count</span><strong>{userDevices.length}</strong></div>
                <div className="metric-tile"><span>Group Count</span><strong>{filteredGroups.length}</strong></div>
              </div>
            ) : (
              <EmptyState icon={<Search size={20} />} title="No user selected" description="Select a cached user or run a lookup." />
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
                      <div className="association-list__item" key={group.id}>
                        <span className="association-list__title">{group.name || group.id}</span>
                        <span className="association-list__meta">{group.id}</span>
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
                      <EmptyState icon={<HardDrive size={18} />} title="No devices" description="No hardware records matched assigned_to for this user." />
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
                      <EmptyState icon={<Ticket size={18} />} title="No tickets" description="No active tickets matched impacted user for this user." />
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
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/user-group-association')}>
                Compare Users
              </button>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/group-search')}>
                Run Flow
              </button>
              {isAdmin ? (
                <>
                  <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/user-group-association?action=add')}>
                    Add to Group
                  </button>
                  <button type="button" className="compact-toggle" onClick={() => navigate('/app/work/user-group-association?action=remove')}>
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
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}

export default GetUserGroupsPage;
