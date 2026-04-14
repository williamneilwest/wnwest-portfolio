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

export function lookupReferenceGroups(searchText) {
  return request(backendBaseUrl, `/api/reference/groups/lookup?q=${encodeURIComponent(searchText)}`);
}

export function lookupReferenceGroupsFromFlow(searchText) {
  return request(backendBaseUrl, `/api/reference/groups/lookup-flow?q=${encodeURIComponent(searchText)}`);
}

export function getUserGroups(userOpid) {
  return request(backendBaseUrl, `/api/reference/groups/user-membership?user_opid=${encodeURIComponent(userOpid)}`);
}

export function getReferenceGroups() {
  return request(backendBaseUrl, '/api/reference/groups');
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
