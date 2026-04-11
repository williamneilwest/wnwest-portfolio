const STORAGE_KEY = 'westos.work.fullDataset';
const SUMMARY_STORAGE_KEY = 'westos.work.aiMetricSummaries';
const HEADER_MAPPING = {
  u_task_1: 'Ticket',
};
const DELIMITER_CANDIDATES = [',', '\t', ';', '|'];

function normalizeHeader(fieldname) {
  let value = String(fieldname ?? '').trim().toLowerCase();

  if (value.includes('.')) {
    value = value.split('.').pop() || '';
  }

  value = value.replace(/\s+/g, '_');
  value = value.replace(/[^a-z0-9_]+/g, '');
  value = value.replace(/^_+|_+$/g, '');

  return value || 'unnamed_column';
}

function normalizeHeaders(fieldnames = []) {
  const seenHeaders = new Map();

  return fieldnames.map((fieldname, index) => {
    const normalized = HEADER_MAPPING[normalizeHeader(fieldname)] || normalizeHeader(fieldname) || `column_${index + 1}`;
    const seenCount = seenHeaders.get(normalized) || 0;
    seenHeaders.set(normalized, seenCount + 1);

    return seenCount ? `${normalized}_${seenCount + 1}` : normalized;
  });
}

function countDelimitedValues(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  const excelSeparatorLine = lines.find((line) => /^sep=./i.test(line));
  if (excelSeparatorLine) {
    return excelSeparatorLine.slice(4, 5) || ',';
  }

  let selectedDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) => countDelimitedValues(line, delimiter)).filter((count) => count > 0);
    if (!counts.length) {
      continue;
    }

    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    if (average > bestScore) {
      bestScore = average;
      selectedDelimiter = delimiter;
    }
  }

  return selectedDelimiter;
}

function parseDelimitedRows(text, delimiter) {
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

    if (character === delimiter && !inQuotes) {
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
  const decodedText = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '');
  const delimiter = detectDelimiter(decodedText);
  const parsedRows = parseDelimitedRows(decodedText, delimiter);

  if (!parsedRows.length) {
    return { columns: [], rows: [] };
  }

  const headerOffset = parsedRows[0]?.length === 1 && /^sep=./i.test(String(parsedRows[0][0] ?? '')) ? 1 : 0;
  const dataRows = parsedRows.slice(headerOffset);
  const maxColumnCount = dataRows.reduce((maxCount, row) => Math.max(maxCount, row.length), 0);

  if (!dataRows.length) {
    return { columns: [], rows: [] };
  }

  const rawHeaders = [...dataRows[0]];
  while (rawHeaders.length < maxColumnCount) {
    rawHeaders.push(`extra_column_${rawHeaders.length + 1}`);
  }

  const headers = normalizeHeaders(rawHeaders);
  const rows = dataRows.slice(1).map((values) =>
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
