import { STORAGE_KEYS, STORAGE_TTLS } from '../../app/constants/storageKeys';
import { storage } from '../../app/utils/storage';

const USER_GROUP_CACHE_KEY = STORAGE_KEYS.USER_GROUPS_CACHE;
const GROUP_LOOKUP_CACHE_KEY = STORAGE_KEYS.GROUP_LOOKUP_CACHE;

function toText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function isInvalidGroupId(id) {
  const normalized = toText(id).toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.includes('$metadata')) {
    return true;
  }
  if (normalized.startsWith('https://graph.microsoft.com')) {
    return true;
  }
  return false;
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object') {
    return null;
  }

  const groupId = toText(group.group_id || group.id || group.groupId || group.value || group.key);
  if (isInvalidGroupId(groupId)) {
    return null;
  }

  const providedName = toText(group.name || group.displayName || group.title);
  const unresolved = !providedName;
  const name = providedName || groupId;
  return { group_id: groupId, name, unresolved };
}

function normalizeGroupsFromRecord(record) {
  const source = Array.isArray(record?.groups)
    ? record.groups
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.resolvedGroups)
        ? record.resolvedGroups
        : Array.isArray(record?.groupList)
          ? record.groupList
          : [];

  const deduped = new Map();
  source.forEach((item) => {
    const normalized = normalizeGroup(item);
    if (normalized?.group_id) {
      deduped.set(normalized.group_id, normalized);
    }
  });
  return Array.from(deduped.values());
}

export function normalizeCachedUserRecord(record, fallbackOpid = '') {
  const opid = toText(
    record?.userOpid
    || record?.opid
    || record?.user_opid
    || record?.id
    || record?.userId
    || fallbackOpid
  );

  if (!opid) {
    return null;
  }

  const displayName = toText(record?.display_name || record?.displayName || record?.name || record?.full_name) || null;
  const email = toText(record?.email || record?.mail || record?.userEmail) || null;
  const jobTitle = toText(record?.job_title || record?.jobTitle || record?.title) || null;
  const department = toText(record?.department || record?.dept || record?.department_name) || null;
  const location = toText(record?.location || record?.site || record?.office_location) || null;
  const physician = toText(record?.physician || record?.u_physician || record?.user_u_physician) || null;
  const costCenter = toText(record?.cost_center || record?.user_cost_center) || null;
  const manager = toText(record?.manager || record?.u_manager || record?.user_manager || record?.cost_center_manager_name) || null;
  const director = toText(record?.director || record?.u_director || record?.user_u_director || record?.director_name) || null;
  const accountEnabled = record?.account_enabled ?? record?.accountEnabled ?? null;
  const groups = normalizeGroupsFromRecord(record);
  const cachedAt = toText(record?.cachedAt || record?.cached_at || record?.timestamp) || null;
  const identifiedCount = Number(record?.identifiedCount ?? record?.identified_count ?? 0) || 0;
  const totalCount = Number(record?.totalCount ?? record?.total_count ?? groups.length) || groups.length;
  const created = Number(record?.created || 0) || 0;
  const source = toText(record?.source || 'flow') || 'flow';

  const fallbackUsed = Boolean(
    record?.userOpid !== opid
    || !Array.isArray(record?.items)
    || record?.display_name !== displayName
  );

  return {
    opid,
    user: {
      opid,
      name: displayName || 'Unknown User',
      email,
    },
    email,
    display_name: displayName,
    job_title: jobTitle,
    department,
    location,
    physician,
    cost_center: costCenter,
    manager,
    director,
    account_enabled: accountEnabled,
    cached_at: cachedAt,
    groups,
    identified_count: identifiedCount,
    total_count: totalCount,
    created,
    source,
    __fallback_used: fallbackUsed,
  };
}

export function toCacheRecord(user) {
  const normalized = normalizeCachedUserRecord(user, user?.opid || '');
  if (!normalized) {
    return null;
  }

  return {
    user: {
      opid: normalized.opid,
      name: normalized.display_name || 'Unknown User',
      email: normalized.email || null,
    },
    userOpid: normalized.opid,
    opid: normalized.opid,
    name: normalized.display_name || '',
    email: normalized.email || '',
    display_name: normalized.display_name || '',
    job_title: normalized.job_title || '',
    department: normalized.department || '',
    location: normalized.location || '',
    physician: normalized.physician || '',
    cost_center: normalized.cost_center || '',
    manager: normalized.manager || '',
    director: normalized.director || '',
    account_enabled: normalized.account_enabled,
    items: normalized.groups,
    groups: normalized.groups,
    resolvedGroups: normalized.groups,
    identifiedCount: normalized.identified_count,
    totalCount: normalized.total_count || normalized.groups.length,
    created: normalized.created,
    cachedAt: normalized.cached_at || new Date().toISOString(),
    source: normalized.source || 'flow',
  };
}

export function normalizeFlowMembershipResponse(response, fallbackOpid = '') {
  const groups = normalizeGroupsFromRecord(response);
  return {
    opid: toText(response?.userOpid || fallbackOpid),
    email: null,
    display_name: null,
    cached_at: new Date().toISOString(),
    groups,
    identified_count: Number(response?.identifiedCount || 0),
    total_count: Number(response?.totalCount || groups.length),
    created: Number(response?.created || 0),
    source: toText(response?.source || 'flow') || 'flow',
  };
}

export function readUserGroupsCacheMap() {
  const parsed = storage.getWithTTL(USER_GROUP_CACHE_KEY);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function writeUserGroupsCacheMap(value) {
  storage.setWithTTL(USER_GROUP_CACHE_KEY, value, STORAGE_TTLS.USER_GROUPS_CACHE);
}

export function getCachedUsersFromMap(cacheMap) {
  return Object.entries(cacheMap || {})
    .map(([fallbackOpid, record]) => normalizeCachedUserRecord(record, fallbackOpid))
    .filter(Boolean)
    .sort((left, right) => left.opid.localeCompare(right.opid));
}

export function getCachedUsersWithDiagnostics(cacheMap) {
  const users = getCachedUsersFromMap(cacheMap);
  const fallbackCount = users.reduce((count, user) => count + (user.__fallback_used ? 1 : 0), 0);
  return { users, fallbackCount };
}

export function getCachedUserByOpid(opid, cacheMap) {
  const normalizedOpid = toText(opid);
  if (!normalizedOpid) {
    return null;
  }
  return getCachedUsersFromMap(cacheMap || readUserGroupsCacheMap())
    .find((user) => user.opid === normalizedOpid) || null;
}

export function getCachedGroupsForUser(opid, cacheMap) {
  return getCachedUserByOpid(opid, cacheMap)?.groups || [];
}

export function upsertCachedUserRecord(user, existingMap = null) {
  const record = toCacheRecord(user);
  if (!record?.userOpid) {
    return existingMap || readUserGroupsCacheMap();
  }

  const current = existingMap && typeof existingMap === 'object' ? existingMap : readUserGroupsCacheMap();
  return {
    ...current,
    [record.userOpid]: record,
  };
}

function normalizeLookupGroup(group) {
  if (!group || typeof group !== 'object') {
    return null;
  }
  const groupId = toText(group.group_id || group.id || group.groupId || group.value || group.key);
  if (isInvalidGroupId(groupId)) {
    return null;
  }
  return {
    group_id: groupId,
    name: toText(group.name || group.displayName || group.title) || groupId,
  };
}

export function readGroupLookupCacheMap() {
  const parsed = storage.getWithTTL(GROUP_LOOKUP_CACHE_KEY);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function writeGroupLookupCacheMap(value) {
  storage.setWithTTL(GROUP_LOOKUP_CACHE_KEY, value, STORAGE_TTLS.GROUP_LOOKUP_CACHE);
}

export function cacheGroupLookupResults(groups, existingMap = null) {
  const current = existingMap && typeof existingMap === 'object' ? existingMap : readGroupLookupCacheMap();
  const next = { ...current };

  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const normalized = normalizeLookupGroup(group);
    if (!normalized) {
      return;
    }
    next[normalized.group_id] = normalized;
  });

  writeGroupLookupCacheMap(next);
  return next;
}
