const backendBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
const aiBaseUrl = backendBaseUrl;

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);

  if (!response.ok) {
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
  const response = await fetch(`${baseUrl}${path}`, options);

  if (!response.ok) {
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

export function getBackendHealth() {
  return request(backendBaseUrl, '/health');
}

export function getSystemStatus() {
  return request(backendBaseUrl, '/flows/system/status');
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

export function getLatestTickets() {
  return request(backendBaseUrl, '/api/tickets/latest');
}

export function getUploads() {
  return request(backendBaseUrl, '/uploads');
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

export async function updateAiSettings(model) {
  const current = await getAISettings();

  return updateAISettings({
    models: {
      preview: model,
      focused: model,
      deep: model,
    },
    pipeline: current.pipeline,
  });
}

export function sendAiChat(messageOrPayload) {
  const payload =
    typeof messageOrPayload === 'string'
      ? { message: messageOrPayload }
      : { ...(messageOrPayload || {}) };

  return request(aiBaseUrl, '/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}
