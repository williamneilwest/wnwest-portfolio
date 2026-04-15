import { isWorkDomainHost } from '../constants/domain';

const backendBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
const aiBaseUrl = backendBaseUrl;

function handleUnauthorizedResponse(response) {
  if (response.status !== 401) {
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  if (isWorkDomainHost()) {
    return;
  }

  window.dispatchEvent(new CustomEvent('westos:auth-required'));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    handleUnauthorizedResponse(response);
    let message = `Request failed with status ${response.status}`;

    try {
      const errorPayload = await response.json();
      message = errorPayload.error || message;
    } catch {
      // Keep the default message when the response body is not JSON.
    }

    throw new Error(message);
  }

  return response.json();
}

async function requestText(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    handleUnauthorizedResponse(response);
    let message = `Request failed with status ${response.status}`;

    try {
      const errorPayload = await response.json();
      message = errorPayload.error || message;
    } catch {
      // Keep the default message when the response body is not JSON.
    }

    throw new Error(message);
  }

  return response.text();
}

function unwrapData(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success')) {
    return payload.data;
  }
  return payload;
}

export function getBackendHealth() {
  return request(backendBaseUrl, '/health');
}

export function getSystemStatus() {
  return request(backendBaseUrl, '/flows/system/status');
}

export async function getSystemServices({ refresh = false } = {}) {
  const suffix = refresh ? '?refresh=true' : '';
  const payload = await request(backendBaseUrl, `/api/system/services${suffix}`);
  return unwrapData(payload);
}

export async function getSystemFeatures({ refresh = false } = {}) {
  const suffix = refresh ? '?refresh=true' : '';
  const payload = await request(backendBaseUrl, `/api/system/features${suffix}`);
  return unwrapData(payload);
}

export async function getSystemDatasets({ refresh = false } = {}) {
  const suffix = refresh ? '?refresh=true' : '';
  const payload = await request(backendBaseUrl, `/api/system/datasets${suffix}`);
  return unwrapData(payload);
}

export async function getSystemAi({ refresh = false } = {}) {
  const suffix = refresh ? '?refresh=true' : '';
  const payload = await request(backendBaseUrl, `/api/system/ai${suffix}`);
  return unwrapData(payload);
}

export async function getSystemAuth(windowHours = 24) {
  const params = new URLSearchParams();
  params.set('windowHours', String(windowHours));
  const payload = await request(backendBaseUrl, `/api/system/auth?${params.toString()}`);
  return unwrapData(payload);
}

export async function getSystemMap({ refresh = false } = {}) {
  const suffix = refresh ? '?refresh=true' : '';
  const payload = await request(backendBaseUrl, `/api/system/map${suffix}`);
  return unwrapData(payload);
}

export function getSystemValidation() {
  return request(backendBaseUrl, '/api/system/validate');
}

export function getLogs({ source = 'docker', container = '', tail = 200 } = {}) {
  const params = new URLSearchParams();
  params.set('source', source);
  params.set('tail', String(tail));
  if (container) {
    params.set('container', container);
  }

  return request(backendBaseUrl, `/api/logs?${params.toString()}`);
}

export function getLogsSummary({ source = 'docker' } = {}) {
  const params = new URLSearchParams();
  params.set('source', source);
  return request(backendBaseUrl, `/api/logs/summary?${params.toString()}`);
}

export function getServices() {
  return request(backendBaseUrl, '/api/services');
}

export function analyzeCsvFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  return request(backendBaseUrl, '/flows/work/analyze-csv', {
    method: 'POST',
    body: formData
  });
}

export function getRecentCsvAnalyses() {
  return request(backendBaseUrl, '/flows/work/recent-analyses');
}

export function getRecentCsvAnalysisFile(analysisId) {
  return requestText(backendBaseUrl, `/flows/work/recent-analyses/${analysisId}/file`);
}

export function getTicket(ticketId) {
  return request(backendBaseUrl, `/api/tickets/${encodeURIComponent(ticketId)}`);
}

export function summarizeTicket(ticketId, payload = {}) {
  return request(backendBaseUrl, `/api/tickets/${encodeURIComponent(ticketId)}/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
}

export function getLatestTickets({ assignee = '' } = {}) {
  const params = new URLSearchParams();
  if (String(assignee || '').trim()) {
    params.set('assignee', String(assignee).trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(backendBaseUrl, `/api/work/tickets${suffix}`);
}

export async function getWorkCodes({ query = '', type = '' } = {}) {
  const params = new URLSearchParams();
  const normalizedQuery = String(query || '').trim();
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedQuery) {
    params.set('q', normalizedQuery);
  }
  if (normalizedType) {
    params.set('type', normalizedType);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await request(backendBaseUrl, `/api/work/codes${suffix}`);
  return unwrapData(payload);
}

export async function createWorkCode({ type = 'qr', text = '', label = '' } = {}) {
  const payload = await request(backendBaseUrl, '/api/work/codes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: String(type || 'qr'),
      text: String(text || ''),
      label: String(label || ''),
    }),
  });
  return unwrapData(payload);
}

export async function uploadWorkCodes(file, { type = 'qr' } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', String(type || 'qr'));
  const payload = await request(backendBaseUrl, '/api/work/codes/upload', {
    method: 'POST',
    body: formData,
  });
  return unwrapData(payload);
}

export function getUploads() {
  return request(backendBaseUrl, '/uploads');
}

export function uploadDataFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  return request(backendBaseUrl, '/api/data/upload', {
    method: 'POST',
    body: formData,
  });
}

export function getDataSources() {
  return request(backendBaseUrl, '/api/data-sources');
}

export function updateDataSource(sourceId, { role = '', key = '', sourceName = '' } = {}) {
  const payload = {};
  if (role !== undefined && role !== null && String(role).trim()) {
    payload.role = String(role).trim();
  }
  if (key !== undefined && key !== null && String(key).trim()) {
    payload.key = String(key).trim();
  }
  if (sourceName !== undefined && sourceName !== null && String(sourceName).trim()) {
    payload.source_name = String(sourceName).trim();
  }
  return request(backendBaseUrl, `/api/data-sources/${encodeURIComponent(String(sourceId || ''))}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
  });
}

export function deleteDataSource(sourceId, { dropTable = true } = {}) {
  return request(backendBaseUrl, `/api/data-sources/${encodeURIComponent(String(sourceId || ''))}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      drop_table: Boolean(dropTable),
    }),
  });
}

export function promoteUploadToSource({ filePath = '', name = '', type = 'csv', schemaVersion = '' } = {}) {
  return request(backendBaseUrl, '/api/data-sources/promote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file_path: filePath,
      name,
      type,
      schema_version: schemaVersion,
    }),
  });
}

export function getDataSourceData(name, { normalized = true } = {}) {
  const params = new URLSearchParams();
  params.set('normalized', String(Boolean(normalized)));
  return request(backendBaseUrl, `/api/data-sources/${encodeURIComponent(String(name || '').trim())}?${params.toString()}`);
}

export function getDataSourceRecord(source, id) {
  const normalizedSource = String(source || '').trim();
  const normalizedId = String(id || '').trim();
  if (!normalizedSource || !normalizedId) {
    throw new Error('source and id are required.');
  }
  return request(
    backendBaseUrl,
    `/api/data-sources/${encodeURIComponent(normalizedSource)}/${encodeURIComponent(normalizedId)}`
  );
}

export function deleteDataSourceRow(name, filters = {}) {
  return request(backendBaseUrl, `/api/data-sources/${encodeURIComponent(String(name || '').trim())}/rows`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ filters }),
  });
}

export function getLegacyDataSourceData(name, { normalized = true } = {}) {
  const params = new URLSearchParams();
  params.set('normalized', String(Boolean(normalized)));
  return request(backendBaseUrl, `/api/data/${encodeURIComponent(String(name || '').trim())}?${params.toString()}`);
}

export function searchUsers(query) {
  const params = new URLSearchParams();
  params.set('q', String(query || '').trim());
  return request(backendBaseUrl, `/api/search-users?${params.toString()}`);
}

export function searchDeviceLocations({ query = '', data, sourceKey = '' } = {}) {
  const payload = {
    query: String(query || '').trim(),
  };
  const normalizedSourceKey = String(sourceKey || '').trim();
  if (normalizedSourceKey) {
    payload.source_key = normalizedSourceKey;
  }
  if (Array.isArray(data)) {
    payload.data = data;
  }

  return request(backendBaseUrl, '/api/device-locations/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
  });
}

export function getDeviceLocationSource() {
  return request(backendBaseUrl, '/api/device-locations/source');
}

export function updateDeviceLocationSource(sourceKey) {
  return request(backendBaseUrl, '/api/device-locations/source', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source_key: String(sourceKey || '').trim(),
    }),
  });
}

export function searchUsersLive(query, { refresh = false } = {}) {
  const params = new URLSearchParams();
  params.set('q', String(query || '').trim());
  if (refresh) {
    params.set('refresh', 'true');
  }
  return request(backendBaseUrl, `/api/search-users-live?${params.toString()}`);
}

export async function getUserContext(username) {
  const normalized = String(username || '').trim();
  if (!normalized) {
    return null;
  }
  return request(backendBaseUrl, `/api/users/context/${encodeURIComponent(normalized)}`);
}

export async function getUsersSourceTable(query, { limit = 200 } = {}) {
  const params = new URLSearchParams();
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery) {
    params.set('q', normalizedQuery);
  }
  params.set('limit', String(limit || 200));
  const payload = await request(backendBaseUrl, `/api/users-source?${params.toString()}`);
  return unwrapData(payload);
}

export function getDataTools(fileType) {
  return request(backendBaseUrl, `/api/data/tools/${encodeURIComponent(fileType)}`);
}

export function getAllFiles() {
  return request(backendBaseUrl, '/api/files');
}

export function reprocessFileForKb(fileId) {
  return request(backendBaseUrl, '/api/files/reprocess', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fileId })
  });
}

export function deleteDataFile(fileId) {
  return request(backendBaseUrl, `/api/data/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  });
}

export function getKnowledgeBase() {
  return request(backendBaseUrl, '/api/kb');
}

export function getMostAccessedKnowledgeBase(limit = 30) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request(backendBaseUrl, `/api/kb/most-accessed?${params.toString()}`);
}

export function analyzeDocument(filePath, agentId = 'kb_ingestion') {
  return request(backendBaseUrl, '/api/analyze/document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file_path: filePath, agent_id: agentId })
  });
}

export function processDocumentByFileId(fileId) {
  return request(backendBaseUrl, '/api/documents/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file_id: fileId })
  });
}

export function analyzeKbDocument(category, filename) {
  return request(backendBaseUrl, '/api/kb/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ category, filename })
  });
}

export function analyzeDocumentWithAi({ documentText = '', documentName = '', documentUrl = '', rerun = false, lookupOnly = false } = {}) {
  return request(backendBaseUrl, '/api/ai/analyze-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      documentText,
      documentName,
      documentUrl,
      rerun,
      lookupOnly,
    })
  });
}

export function updateFileById(fileId, payload) {
  return request(backendBaseUrl, `/api/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
}

export function deleteFileById(fileId) {
  return request(backendBaseUrl, `/api/files/${fileId}`, {
    method: 'DELETE'
  });
}

export function getAnalyzedDocuments() {
  return request(backendBaseUrl, '/api/documents');
}

export function getAnalyzedDocument(documentId) {
  return request(backendBaseUrl, `/api/documents/${encodeURIComponent(documentId)}`);
}

export function getProcessedKnowledgeBase() {
  return request(backendBaseUrl, '/api/kb/processed');
}

export function getProcessedKnowledgeBaseDocument(filename) {
  return request(backendBaseUrl, `/api/kb/processed/${encodeURIComponent(filename)}`);
}

function normalizeGroupRecord(group) {
  const groupId = String(group?.group_id || group?.id || '').trim();
  return {
    group_id: groupId,
    name: String(group?.name || groupId).trim() || groupId,
    description: String(group?.description || '').trim(),
    tags: group?.tags || '',
    identified: Boolean(group?.identified),
  };
}

export function lookupReferenceGroups(searchText) {
  return request(backendBaseUrl, `/api/reference/groups/lookup?q=${encodeURIComponent(searchText)}`)
    .then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items.map(normalizeGroupRecord) : [];
      return { ...(payload || {}), items };
    });
}

export function searchGroupsCacheFirst(searchText, { refresh = false } = {}) {
  const params = new URLSearchParams();
  params.set('q', String(searchText || '').trim());
  if (refresh) {
    params.set('refresh', 'true');
  }
  return request(backendBaseUrl, `/api/groups/search?${params.toString()}`)
    .then((payload) => {
      const results = Array.isArray(payload?.results) ? payload.results.map((group) => ({
        id: String(group?.id || group?.group_id || '').trim(),
        name: String(group?.name || '').trim(),
        description: String(group?.description || '').trim(),
      })) : [];
      return { ...(payload || {}), results };
    });
}

export function lookupReferenceGroupsFromFlow(searchText) {
  return request(backendBaseUrl, `/api/reference/groups/lookup-flow?q=${encodeURIComponent(searchText)}`)
    .then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items.map(normalizeGroupRecord) : [];
      return { ...(payload || {}), items };
    });
}

export function getUserGroups(userOpid) {
  return request(backendBaseUrl, `/api/reference/groups/user-membership?user_opid=${encodeURIComponent(userOpid)}`)
    .then((payload) => {
      const groups = Array.isArray(payload?.groups)
        ? payload.groups.map((group) => ({ group_id: String(group?.group_id || '').trim() })).filter((group) => group.group_id)
        : Array.isArray(payload?.items)
          ? payload.items.map((group) => ({ group_id: String(group?.group_id || group?.id || '').trim() })).filter((group) => group.group_id)
          : [];
      return { ...(payload || {}), groups };
    });
}

export function getReferenceGroups() {
  return request(backendBaseUrl, '/api/reference/groups')
    .then((payload) => (Array.isArray(payload) ? payload.map(normalizeGroupRecord) : []));
}

export function upsertReferenceGroups(groups) {
  return request(backendBaseUrl, '/api/reference/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ groups })
  });
}

export function getReferenceUsers() {
  return request(backendBaseUrl, '/api/reference/users');
}

export function getReferenceEndpoints() {
  return request(backendBaseUrl, '/api/reference/endpoints');
}

export function upsertReferenceUsers(users) {
  return request(backendBaseUrl, '/api/reference/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ users })
  });
}

export function getUploadFile(fileUrl) {
  return requestText(backendBaseUrl, fileUrl);
}

export function updateTicketAssignee(ticketId, assignee) {
  return request(backendBaseUrl, '/api/tickets/update-assignee', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ticket_id: ticketId,
      assignee,
    })
  });
}

export function getAiHealth() {
  return request(aiBaseUrl, '/api/ai/health');
}

export function getFlowRuns({ flowName = '', status = '', userId = '', limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (String(flowName || '').trim()) {
    params.set('flow_name', String(flowName).trim());
  }
  if (String(status || '').trim()) {
    params.set('status', String(status).trim());
  }
  if (String(userId || '').trim()) {
    params.set('user_id', String(userId).trim());
  }
  params.set('limit', String(limit || 100));
  return request(backendBaseUrl, `/api/flows/runs?${params.toString()}`);
}

export function getFlowRunById(runId) {
  return request(backendBaseUrl, `/api/flows/runs/${encodeURIComponent(String(runId || ''))}`);
}

export function getFlowTemplates() {
  return request(backendBaseUrl, '/api/flows/templates');
}

export function createFlowTemplate(template) {
  return request(backendBaseUrl, '/api/flows/templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(template || {})
  });
}

export function updateFlowTemplate(templateId, template) {
  return request(backendBaseUrl, `/api/flows/templates/${encodeURIComponent(String(templateId || ''))}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(template || {})
  });
}

export function deleteFlowTemplate(templateId) {
  return request(backendBaseUrl, `/api/flows/templates/${encodeURIComponent(String(templateId || ''))}`, {
    method: 'DELETE'
  });
}

export function runFlowTemplate(templateId, variables = {}) {
  return request(backendBaseUrl, `/api/flows/templates/${encodeURIComponent(String(templateId || ''))}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ variables: variables || {} })
  });
}

export function getAiInteractionLogs(limit = 200) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return request(aiBaseUrl, `/api/ai/logs?${params.toString()}`);
}

export function getSettings() {
  return request(backendBaseUrl, '/api/settings');
}

export function getAISettings() {
  return request(backendBaseUrl, '/api/settings/ai');
}

export function updateAISettings(data) {
  return request(backendBaseUrl, '/api/settings/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
}

export function getAgents() {
  return request(backendBaseUrl, '/api/agents');
}

export function createAgent(data) {
  return request(backendBaseUrl, '/api/agents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data || {})
  });
}

export function updateAgent(agentId, data) {
  return request(backendBaseUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data || {})
  });
}

export function deleteAgent(agentId) {
  return request(backendBaseUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE'
  });
}

export async function updateAiSettings(model) {
  const current = await getAISettings();

  return updateAISettings({
    models: {
      preview: model,
      focused: model,
      deep: model,
      document_processing: model,
    },
    pipeline: current.pipeline,
  });
}

export function sendAiChat(messageOrPayload) {
  const payload =
    typeof messageOrPayload === 'string'
      ? { message: messageOrPayload }
      : { ...(messageOrPayload || {}) };

  if (payload.agentId && !payload.agent_id) {
    payload.agent_id = payload.agentId;
  }
  delete payload.agentId;

  return request(aiBaseUrl, '/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function askAssistant({ query, currentRoute, context }) {
  const payload = {
    query,
    current_route: currentRoute
  };

  if (context && typeof context === 'object') {
    payload.context = context;
  }

  return request(backendBaseUrl, '/api/assistant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function getAdminFlowTemplates() {
  return request(backendBaseUrl, '/api/admin/flow-templates');
}

export function createAdminFlowTemplate(template) {
  return request(backendBaseUrl, '/api/admin/flow-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(template || {})
  });
}

export function updateAdminFlowTemplate(templateId, template) {
  return request(backendBaseUrl, `/api/admin/flow-templates/${encodeURIComponent(String(templateId || ''))}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(template || {})
  });
}

export function runAdminFlowTemplate(templateId, variables = {}) {
  return request(backendBaseUrl, `/api/admin/flow-templates/${encodeURIComponent(String(templateId || ''))}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ variables: variables || {} })
  });
}

export function runFlow(template, variables = {}) {
  if (template?.id) {
    return runFlowTemplate(template.id, variables);
  }

  return request(backendBaseUrl, '/api/admin/flow-templates/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template: template || {},
      variables: variables || {}
    })
  });
}

export function runDevCodexPrompt(prompt) {
  return request(backendBaseUrl, '/api/dev/codex/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt: String(prompt || '') })
  });
}

export function applyDevCodexChanges({ stageId, approvedFiles = [] } = {}) {
  return request(backendBaseUrl, '/api/dev/codex/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stage_id: String(stageId || ''),
      approved_files: Array.isArray(approvedFiles) ? approvedFiles : [],
    })
  });
}

export function rejectDevCodexChanges(stageId) {
  return request(backendBaseUrl, '/api/dev/codex/reject', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ stage_id: String(stageId || '') })
  });
}

export function getSoftwareRegistry() {
  return request(backendBaseUrl, '/api/software');
}

export function searchSoftwareRegistry(query, { limit = 50 } = {}) {
  const params = new URLSearchParams();
  params.set('q', String(query || '').trim());
  params.set('limit', String(limit || 50));
  return request(backendBaseUrl, `/api/software/search?${params.toString()}`);
}

export function uploadSoftwareRegistry(file, { mode = 'replace' } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', String(mode || 'replace'));
  return request(backendBaseUrl, '/api/software/upload', {
    method: 'POST',
    body: formData,
  });
}
