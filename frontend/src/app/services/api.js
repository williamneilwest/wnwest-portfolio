const backendBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
const aiBaseUrl = import.meta.env.VITE_AI_BASE_URL || '';

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

export function getAiHealth() {
  return request(aiBaseUrl, '/api/ai/health');
}

export function sendAiChat(message) {
  return request(aiBaseUrl, '/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });
}
