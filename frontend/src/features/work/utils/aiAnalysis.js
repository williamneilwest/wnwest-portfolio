const ID_PATTERNS = [/^u_task_1$/i, /^task_1$/i, /^number$/i, /ticket/i, /case/i, /incident/i, /request/i, /^id$/i];
const TITLE_PATTERNS = [/short_description/i, /subject/i, /title/i, /summary/i, /description/i];
const ASSIGNEE_PATTERNS = [/assigned_to/i, /assignee/i, /owner/i, /agent/i];
const STATUS_PATTERNS = [/^state$/i, /^status$/i, /priority/i, /severity/i];
const ACTIVE_PATTERNS = [/^active$/i, /is_active/i, /open/i];
const UPDATED_PATTERNS = [/sys_updated_on/i, /updated/i, /last.?updated/i, /modified/i];
const PRIMARY_NOTE_COLUMN = 'comments_and_work_notes';
const SUPPRESSED_COLUMNS = new Set(['comments', 'work_notes']);
const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?(?:z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?)/i;
const AUTHOR_PATTERN = /\b(?:by|author|user|updated by)\s*[:\-]?\s*([a-z][a-z .,'_-]{1,60})/i;
const AI_SECTION_KEYS = {
  summary: 'summary',
  'root cause': 'rootCause',
  'work performed': 'workPerformed',
  blocker: 'blocker',
  'next step': 'nextStep',
  'stalled status': 'stalledStatus',
};

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function findColumn(columns = [], patterns = []) {
  return columns.find((column) => patterns.some((pattern) => pattern.test(column))) || '';
}

function splitNoteEntries(value) {
  const text = normalizeValue(value);

  if (!text) {
    return [];
  }

  const chunks = text
    .split(/\n{2,}|(?:^|\n)[-*]\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return chunks.length ? chunks : [text];
}

function parseDate(value) {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function extractDate(value) {
  const text = normalizeValue(value);
  const match = text.match(DATE_PATTERN);
  return match ? parseDate(match[1]) : null;
}

function extractAuthor(value) {
  const text = normalizeValue(value);
  const match = text.match(AUTHOR_PATTERN);
  return match ? normalizeValue(match[1]) : '';
}

function formatLabel(value) {
  if (['u_task_1', 'task_1'].includes(normalizeValue(value).toLowerCase())) {
    return 'Ticket Number';
  }

  return normalizeValue(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getTicketColumns(columns = []) {
  const noteColumns = columns.includes(PRIMARY_NOTE_COLUMN) ? [PRIMARY_NOTE_COLUMN] : [];

  return {
    id: findColumn(columns, ID_PATTERNS),
    title: findColumn(columns, TITLE_PATTERNS),
    assignee: findColumn(columns, ASSIGNEE_PATTERNS),
    status: findColumn(columns, STATUS_PATTERNS),
    active: findColumn(columns, ACTIVE_PATTERNS),
    updated: findColumn(columns, UPDATED_PATTERNS),
    noteColumns,
  };
}

export function isSuppressedTicketColumn(column) {
  return SUPPRESSED_COLUMNS.has(normalizeValue(column).toLowerCase());
}

export function getTicketId(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.id]) || normalizeValue(ticket?.id) || 'Untitled ticket';
}

export function getTicketTitle(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.title]) || getTicketId(ticket, columns);
}

export function getTicketAssignee(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.assignee]) || 'Unassigned';
}

export function getTicketStatus(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.status]) || 'Unknown';
}

export function isActiveTicket(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  const activeValue = normalizeValue(ticket?.[fieldMap.active]).toLowerCase();

  if (!fieldMap.active) {
    return false;
  }

  return activeValue === 'true' || activeValue === '1' || activeValue === 'yes' || activeValue === 'active' || activeValue === 'open';
}

export function getTicketNotes(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  const notes = fieldMap.noteColumns.flatMap((column) =>
    splitNoteEntries(ticket?.[column]).map((entry, index) => ({
      id: `${column}-${index}`,
      label: formatLabel(column),
      type: formatLabel(column),
      value: entry,
      timestamp: extractDate(entry),
      author: extractAuthor(entry),
    }))
  );

  return [...notes].reverse();
}

export function compress_notes(notes, limit = 5) {
  return notes
    .slice(-limit)
    .map((note) => `${note.type}: ${note.value}`)
    .join('\n\n');
}

export function get_last_update_info(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  const notes = getTicketNotes(ticket, columns);
  const lastNote = notes[notes.length - 1] || null;
  const updatedAt = parseDate(ticket?.[fieldMap.updated]) || lastNote?.timestamp || null;
  const daysSince =
    updatedAt ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / (24 * 60 * 60 * 1000))) : null;

  return {
    updatedAt,
    days_since: daysSince,
    last_author: lastNote?.author || getTicketAssignee(ticket, columns),
    last_type: lastNote?.type || 'General Update',
  };
}

export function getTicketLastUpdatedLabel(ticket, columns = Object.keys(ticket || {})) {
  const info = get_last_update_info(ticket, columns);

  if (!info.updatedAt) {
    return 'Unknown';
  }

  return info.updatedAt.toLocaleString();
}

export function build_prompt(ticket, days_since, last_author, last_type) {
  const columns = Object.keys(ticket || {});
  const fieldMap = getTicketColumns(columns);
  const notes = getTicketNotes(ticket, columns);
  const metadataLines = columns
    .filter((column) => !fieldMap.noteColumns.includes(column) && !isSuppressedTicketColumn(column))
    .map((column) => `${formatLabel(column)}: ${normalizeValue(ticket?.[column]) || 'Unknown'}`);

  return [
    'You are an operations ticket analyst.',
    'Review the ticket context and provide concise sections with these exact headings:',
    'Summary:',
    'Root cause:',
    'Work performed:',
    'Blocker:',
    'Next step:',
    'Stalled status:',
    '',
    `Ticket ID: ${getTicketId(ticket, columns)}`,
    `Title: ${getTicketTitle(ticket, columns)}`,
    `Assigned to: ${getTicketAssignee(ticket, columns)}`,
    `Status: ${getTicketStatus(ticket, columns)}`,
    `Days since last update: ${days_since ?? 'Unknown'}`,
    `Last update author: ${last_author || 'Unknown'}`,
    `Last update type: ${last_type || 'Unknown'}`,
    '',
    'Ticket metadata:',
    metadataLines.join('\n'),
    '',
    'Recent notes:',
    compress_notes(notes, 5) || 'No notes available.',
  ].join('\n');
}

export function parseTicketAiAnalysis(result) {
  const template = {
    summary: '',
    rootCause: '',
    workPerformed: '',
    blocker: '',
    nextStep: '',
    stalledStatus: '',
  };

  const lines = normalizeValue(result)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection = 'summary';

  for (const line of lines) {
    const normalized = line.replace(/^[-*#\s]+/, '').replace(/:+$/, '').toLowerCase();
    const nextSection = AI_SECTION_KEYS[normalized];

    if (nextSection) {
      currentSection = nextSection;
      continue;
    }

    const sectionMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (sectionMatch) {
      const maybeSection = AI_SECTION_KEYS[sectionMatch[1].trim().toLowerCase()];
      if (maybeSection) {
        currentSection = maybeSection;
        template[currentSection] = sectionMatch[2].trim();
        continue;
      }
    }

    const content = line.replace(/^[-*]\s*/, '').trim();
    if (!content) {
      continue;
    }

    template[currentSection] = template[currentSection]
      ? `${template[currentSection]} ${content}`
      : content;
  }

  return template;
}

export function findTicketById(dataset, ticketId) {
  if (!dataset?.rows?.length) {
    return null;
  }

  return dataset.rows.find((row) => getTicketId(row, dataset.columns) === ticketId) || null;
}

export function updateTicketAnalysis(dataset, ticketId, aiAnalysis) {
  if (!dataset?.rows?.length) {
    return dataset;
  }

  return {
    ...dataset,
    rows: dataset.rows.map((row) =>
      getTicketId(row, dataset.columns) === ticketId
        ? {
            ...row,
            ai_analysis: aiAnalysis,
          }
        : row
    ),
  };
}
