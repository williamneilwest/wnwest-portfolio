const STORAGE_KEY = 'westos.work.fullDataset';
const SUMMARY_STORAGE_KEY = 'westos.work.aiMetricSummaries';

function normalizeHeaders(fieldnames = []) {
  return fieldnames.map((fieldname) => {
    const value = String(fieldname ?? '').trim();
    return value || 'unnamed_column';
  });
}

function parseCsvRows(text) {
  const rows = [];
  let currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += character;
  }

  currentRow.push(currentValue);
  rows.push(currentRow);

  return rows.filter((row) => row.some((value) => String(value ?? '').trim()));
}

export function parseCsvText(text) {
  const decodedText = String(text ?? '').replace(/^\uFEFF/, '');
  const parsedRows = parseCsvRows(decodedText);

  if (!parsedRows.length) {
    return { columns: [], rows: [] };
  }

  const headers = normalizeHeaders(parsedRows[0]);
  const rows = parsedRows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  );

  return { columns: headers, rows };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function loadInitialCache() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let cachedDataset = loadInitialCache();
let cachedSummaries = (() => {
  if (!canUseStorage()) {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(SUMMARY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

export function getCachedWorkDataset() {
  return cachedDataset;
}

export function setCachedWorkDataset(payload) {
  cachedDataset = payload;

  if (!canUseStorage()) {
    return;
  }

  try {
    if (payload) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage write failures.
  }
}

export function getCachedAiMetricSummary(cacheKey) {
  return cachedSummaries[cacheKey] || '';
}

export function setCachedAiMetricSummary(cacheKey, summary) {
  cachedSummaries = {
    ...cachedSummaries,
    [cacheKey]: summary,
  };

  if (!canUseStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(cachedSummaries));
  } catch {
    // Ignore storage write failures.
  }
}
