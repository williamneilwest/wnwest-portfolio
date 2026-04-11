const ID_PATTERNS = [/^u_task_1$/i, /^task_1$/i, /^number$/i, /ticket/i, /case/i, /incident/i, /request/i, /^id$/i];
const TITLE_PATTERNS = [/short_description/i, /subject/i, /title/i, /summary/i, /description/i];
const ASSIGNEE_PATTERNS = [/assigned_to/i, /assignee/i, /owner/i, /agent/i];
const STATUS_PATTERNS = [/^state$/i, /^status$/i, /priority/i, /severity/i];
const ACTIVE_PATTERNS = [/^active$/i, /is_active/i, /open/i];
const UPDATED_PATTERNS = [/sys_updated_on/i, /updated/i, /last.?updated/i, /modified/i];
const PRIMARY_NOTE_COLUMN = 'comments_and_work_notes';
const SUPPRESSED_COLUMNS = new Set(['comments', 'work_notes']);
const IGNORED_NOTE_CONTENTS = new Set(['text has been sent']);
const ACKNOWLEDGEMENT_PATTERN = /\back?no?w?l?e?d?g(?:e|ed|ement|ing)\b|\backnolwedge\b/i;
const HELPDESK_THANK_YOU_PATTERN = /thank you for taking the time to submit a ticket to the helpdesk/i;
const HEADER_AUTHOR_TYPE_PATTERN = /^([^\n(]+?)\s*\(([^)]+)\)\s*/i;
const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?(?:z|[+-]\d{2}:?\d{2})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?)/i;
const AUTHOR_PATTERN = /\b(?:by|author|user|updated by)\s*[:\-]?\s*([a-z][a-z .,'_-]{1,60})/i;
const AI_SECTION_KEYS = {
  summary: 'summary',
  'work notes': 'workNotes',
  comments: 'comments',
  status: 'status',
};

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function normalizeNoteContent(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldIgnoreNote(value) {
  return IGNORED_NOTE_CONTENTS.has(normalizeNoteContent(value));
}

function normalizeNoteDisplayContent(value) {
  const content = normalizeValue(value);

  if (!content) {
    return '';
  }

  if (HELPDESK_THANK_YOU_PATTERN.test(content)) {
    return 'User submitted helpdesk ticket.';
  }

  if (ACKNOWLEDGEMENT_PATTERN.test(content)) {
    return 'User acknowledged ticket.';
  }

  return content;
}

function truncateNoteContent(value, maxLength = 100) {
  const normalized = normalizeValue(value).replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
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
  const headerMatch = text.match(HEADER_AUTHOR_TYPE_PATTERN);
  if (headerMatch) {
    return normalizeValue(headerMatch[1]);
  }
  const match = text.match(AUTHOR_PATTERN);
  return match ? normalizeValue(match[1]) : '';
}

function extractNoteType(value, fallback = 'Comments and Work Notes') {
  const text = normalizeValue(value);
  const headerMatch = text.match(HEADER_AUTHOR_TYPE_PATTERN);
  return headerMatch ? normalizeValue(headerMatch[2]) : fallback;
}

function cleanNoteBody(value) {
  const text = normalizeValue(value);

  if (!text) {
    return '';
  }

  const headerMatch = text.match(HEADER_AUTHOR_TYPE_PATTERN);
  if (!headerMatch) {
    return text;
  }

  return text.slice(headerMatch[0].length).trim();
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

export function dedupeNotes(notes = []) {
  const seen = new Map();

  for (const note of notes) {
    const normalizedContent = normalizeNoteContent(note.content || note.value || '');
    const timestampValue =
      note.timestamp instanceof Date
        ? note.timestamp.toISOString()
        : normalizeValue(note.timestamp);
    const key = `${timestampValue}_${normalizedContent}`;

    if (!seen.has(key)) {
      seen.set(key, note);
      continue;
    }

    const existing = seen.get(key);
    const existingType = normalizeValue(existing?.type).toLowerCase();
    const nextType = normalizeValue(note?.type).toLowerCase();

    if (existingType !== 'work notes' && nextType === 'work notes') {
      seen.set(key, note);
    }
  }

  return Array.from(seen.values());
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
    splitNoteEntries(ticket?.[column])
      .map((entry, index) => {
        const cleanedBody = normalizeNoteDisplayContent(cleanNoteBody(entry));
        const author = extractAuthor(entry);
        const type = extractNoteType(entry, formatLabel(column));

        return {
          id: `${column}-${index}`,
          label: author ? `${author} · ${type}` : type,
          type,
          value: cleanedBody,
          content: cleanedBody,
          timestamp: extractDate(entry),
          author,
        };
      })
      .filter((note) => !shouldIgnoreNote(note.content))
  );

  return dedupeNotes(notes).sort((left, right) => {
    const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : -Infinity;
    const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : -Infinity;

    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

export function compress_notes(notes, limit = 3) {
  return notes
    .slice(0, limit)
    .map((note) => truncateNoteContent(note.value, 100))
    .join('\n\n');
}

export function get_last_update_info(ticket, columns = Object.keys(ticket || {})) {
  const fieldMap = getTicketColumns(columns);
  const notes = getTicketNotes(ticket, columns);
  const lastNote = notes[0] || null;
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

function buildTicketSummaryPayload(ticket) {
  const columns = Object.keys(ticket || {});
  const fieldMap = getTicketColumns(columns);
  const notes = getTicketNotes(ticket, columns);
  const metadataEntries = columns
    .filter((column) => !fieldMap.noteColumns.includes(column) && !isSuppressedTicketColumn(column))
    .map((column) => [formatLabel(column), normalizeValue(ticket?.[column])])
    .filter(([, value]) => value);

  const workNotes = notes
    .filter((note) => /work/i.test(note.type))
    .slice(0, 5)
    .map((note) => ({
      author: note.author || undefined,
      timestamp: note.timestamp ? note.timestamp.toISOString() : undefined,
      content: truncateNoteContent(note.value, 220),
    }));

  const comments = notes
    .filter((note) => !/work/i.test(note.type))
    .slice(0, 5)
    .map((note) => ({
      author: note.author || undefined,
      timestamp: note.timestamp ? note.timestamp.toISOString() : undefined,
      content: truncateNoteContent(note.value, 220),
    }));

  return Object.fromEntries(
    [
      ['ticket', getTicketId(ticket, columns)],
      ['title', getTicketTitle(ticket, columns)],
      ['assigned_to', getTicketAssignee(ticket, columns)],
      ['status', getTicketStatus(ticket, columns)],
      ...metadataEntries,
      ['work_notes', workNotes],
      ['comments', comments],
    ].filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return Boolean(value);
    })
  );
}

export function build_prompt(ticket, days_since, last_author, last_type) {
  const ticketPayload = buildTicketSummaryPayload(ticket);

  return [
    'You are a strict data summarizer.',
    '',
    'Rules:',
    '- Only summarize what is explicitly present',
    '- Do NOT infer, guess, or speculate',
    '- Do NOT provide recommendations or next steps',
    '- Do NOT diagnose issues',
    '- Keep output concise and structured',
    '- Prioritize speed and clarity over detail',
    '',
    'Summarize the following ticket data.',
    '',
    'Return ONLY the following sections:',
    '',
    'Summary:',
    '- 1-2 sentences describing the issue',
    '',
    'Work Notes:',
    '- Bullet list of key actions performed',
    '',
    'Comments:',
    '- Bullet list of important user or technician comments',
    '',
    'Status:',
    '- Current state based strictly on the latest entry',
    '',
    'Keep everything short, factual, and clean.',
    '',
    'DATA:',
    JSON.stringify(ticketPayload, null, 2),
  ].join('\n');
}

export function parseTicketAiAnalysis(result) {
  const template = {
    summary: '',
    workNotes: [],
    comments: [],
    status: '',
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
        if (currentSection === 'workNotes' || currentSection === 'comments') {
          template[currentSection].push(sectionMatch[2].trim());
        } else {
          template[currentSection] = sectionMatch[2].trim();
        }
        continue;
      }
    }

    const content = line.replace(/^[-*]\s*/, '').trim();
    if (!content) {
      continue;
    }

    if (currentSection === 'workNotes' || currentSection === 'comments') {
      template[currentSection].push(content);
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
