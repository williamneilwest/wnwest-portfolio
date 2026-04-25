const ID_PATTERNS = [/^u_task_1$/i, /^task_1$/i, /^number$/i, /ticket/i, /case/i, /incident/i, /request/i, /^id$/i];
const TITLE_PATTERNS = [/short_description/i, /subject/i, /title/i, /summary/i, /description/i];
const ASSIGNEE_PATTERNS = [/assigned_to/i, /assignee/i, /owner/i, /agent/i];
const STATUS_PATTERNS = [/^state$/i, /^status$/i, /priority/i, /severity/i];
const ACTIVE_PATTERNS = [/^active$/i, /is_active/i, /open/i];
const UPDATED_PATTERNS = [/sys_updated_on/i, /updated/i, /last.?updated/i, /modified/i];
const PRIMARY_NOTE_COLUMN = 'combined_notes';
const SUPPRESSED_COLUMNS = new Set(['comments', 'work_notes']);
const NOTE_COLUMN_PATTERNS = [
  /^combined_?notes?$/i,
  /^comments_and_work_notes$/i,
  /^comments?_and_?work_?notes?$/i,
  /^comments?\s*and\s*work\s*notes?$/i,
  /^comments?$/i,
  /^work_?notes?$/i,
  /^work_?notes_?list$/i,
  /^wf_?activity$/i,
  /^workflow_?activity$/i,
  /^u_task_1\.comments$/i,
  /^u_task_1\.work_notes$/i,
  /^u_task_1\.comments_and_work_notes$/i,
  /^u_task_1\.work_notes_list$/i,
  /^u_task_1\.wf_activity$/i,
];
const EMPTY_NOTE_TOKENS = new Set(['', 'null', 'none', 'nan', '[]', '{}']);
const NOTE_FALLBACK_COLUMNS = [
  'combined_notes',
  'comments_and_work_notes',
  'work_notes',
  'comments',
  'work_notes_list',
  'workflow_activity',
  'wf_activity',
  'u_task_1.comments_and_work_notes',
  'u_task_1.work_notes',
  'u_task_1.comments',
  'u_task_1.work_notes_list',
  'u_task_1.wf_activity',
  'description',
  'u_task_1.description',
];
const IGNORED_NOTE_CONTENTS = new Set(['text has been sent']);
const ACKNOWLEDGEMENT_PATTERN = /\back?no?w?l?e?d?g(?:e|ed|ement|ing)\b|\backnolwedge\b/i;
const HELPDESK_THANK_YOU_PATTERN = /thank you (?:for )?(?:placing|submitting) (?:a )?ticket(?: to the helpdesk)?/i;
// Common boilerplate messages that add no analytical value and should be removed early
const BOILERPLATE_NOTE_PATTERNS = [
  /\btext has been sent\.?/i,
  /\bsms (?:has been )?sent\.?/i,
  /\btext sent\.?/i,
  /\bmessage sent\.?/i,
  /\bnotification sent\.?/i,
  /\b(auto[- ]?reply|automatic notification)\b/i,
  /\bthank you .* (?:submit(?:ting)?|placing) .*ticket\b/i,
  /\bthank you for (?:placing|submitting) (?:a )?ticket\b/i,
  /\b(ticket )?acknowledge(?:d|ment)\b/i,
  /\byour ticket (?:has been )?(?:received|created)\b/i,
];
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
const TICKET_VALUE_PATTERN = /\b(?:INC|TASK|REQ)\s*[-_]?\s*\d+\b/i;

function normalizeValue(value) {
  return String(value ?? '').trim();
}

export function clean_note_value(value) {
  const text = normalizeValue(value);
  if (!text) {
    return '';
  }
  if (EMPTY_NOTE_TOKENS.has(text.toLowerCase())) {
    return '';
  }
  return text;
}

function getFirstCleanValue(ticket, keys = []) {
  for (const key of keys) {
    if (!ticket || !(key in ticket)) {
      continue;
    }
    const cleaned = clean_note_value(ticket[key]);
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
}

export function resolve_combined_notes(ticket) {
  const firstPass = [
    ['comments_and_work_notes', ['combined_notes', 'comments_and_work_notes', 'u_task_1.comments_and_work_notes']],
    ['work_notes', ['work_notes', 'u_task_1.work_notes']],
    ['comments', ['comments', 'u_task_1.comments']],
    ['work_notes_list', ['work_notes_list', 'u_task_1.work_notes_list']],
    ['workflow_activity', ['workflow_activity', 'wf_activity', 'u_task_1.wf_activity']],
  ];
  const pieces = [];
  const seen = new Set();

  for (const [, keys] of firstPass) {
    const value = getFirstCleanValue(ticket, keys);
    const dedupeKey = normalizeNoteContent(value);
    if (!value || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    pieces.push(value);
  }

  if (!pieces.length) {
    const description = getFirstCleanValue(ticket, ['description', 'u_task_1.description']);
    if (description) {
      pieces.push(description);
    }
  }

  return pieces.join('\n\n').trim();
}

function normalizeNoteContent(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldIgnoreNote(value) {
  const normalized = normalizeNoteContent(value);
  if (!normalized) return true;

  if (IGNORED_NOTE_CONTENTS.has(normalized)) return true;

  // Filter common boilerplate phrases
  if (ACKNOWLEDGEMENT_PATTERN.test(value)) return true;
  if (HELPDESK_THANK_YOU_PATTERN.test(value)) return true;
  if (BOILERPLATE_NOTE_PATTERNS.some((re) => re.test(value))) return true;

  return false;
}

function normalizeNoteDisplayContent(value) {
  const content = normalizeValue(value);

  if (!content) {
    return '';
  }

  // If content matches boilerplate it will be removed by shouldIgnoreNote before display

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
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitNoteEntries(entry));
  }

  if (value && typeof value === 'object') {
    const content = normalizeValue(
      value.content ?? value.value ?? value.text ?? value.body ?? value.message
    );
    return content ? splitNoteEntries(content) : [];
  }

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

function extractNoteType(value, fallback = 'Comments and work Notes') {
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
  const detectedNoteColumns = columns.filter((column) =>
    NOTE_COLUMN_PATTERNS.some((pattern) => pattern.test(normalizeValue(column)))
  );
  const orderedNoteColumns = Array.from(
    new Set(
      [
        ...detectedNoteColumns.filter(
          (column) => normalizeValue(column).toLowerCase() === PRIMARY_NOTE_COLUMN
        ),
        ...detectedNoteColumns.filter(
          (column) => normalizeValue(column).toLowerCase() !== PRIMARY_NOTE_COLUMN
        ),
      ]
    )
  );

  return {
    id: columns.includes('ticket_id') ? 'ticket_id' : findColumn(columns, ID_PATTERNS),
    title: columns.includes('title') ? 'title' : findColumn(columns, TITLE_PATTERNS),
    assignee: columns.includes('assignee') ? 'assignee' : findColumn(columns, ASSIGNEE_PATTERNS),
    status: columns.includes('status') ? 'status' : findColumn(columns, STATUS_PATTERNS),
    active: findColumn(columns, ACTIVE_PATTERNS),
    updated: columns.includes('updated_at') ? 'updated_at' : findColumn(columns, UPDATED_PATTERNS),
    noteColumns: orderedNoteColumns,
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
  const canonicalId = normalizeValue(ticket?.ticket_id);
  if (canonicalId) {
    return canonicalId;
  }
  const fieldMap = getTicketColumns(columns);
  const explicitId = normalizeValue(ticket?.[fieldMap.id]) || normalizeValue(ticket?.id);
  if (explicitId) {
    return explicitId;
  }

  if (ticket && typeof ticket === 'object') {
    for (const value of Object.values(ticket)) {
      const text = normalizeValue(value);
      if (text && TICKET_VALUE_PATTERN.test(text)) {
        return text;
      }
    }
  }

  return 'Unknown ticket';
}

export function getTicketTitle(ticket, columns = Object.keys(ticket || {})) {
  const canonicalTitle = normalizeValue(ticket?.title);
  if (canonicalTitle) {
    return canonicalTitle;
  }
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.title]) || getTicketId(ticket, columns);
}

export function getTicketAssignee(ticket, columns = Object.keys(ticket || {})) {
  const canonicalAssignee = normalizeValue(ticket?.assignee);
  if (canonicalAssignee) {
    return canonicalAssignee;
  }
  const fieldMap = getTicketColumns(columns);
  return normalizeValue(ticket?.[fieldMap.assignee]) || 'Unassigned';
}

export function getTicketStatus(ticket, columns = Object.keys(ticket || {})) {
  const canonicalStatus = normalizeValue(ticket?.status);
  if (canonicalStatus) {
    return canonicalStatus;
  }
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
  const combinedNotes = normalizeValue(ticket?.combined_notes) || resolve_combined_notes(ticket);
  const sourceColumns = combinedNotes
    ? ['combined_notes']
    : Array.from(
      new Set([
        ...fieldMap.noteColumns,
        ...NOTE_FALLBACK_COLUMNS.filter((column) => clean_note_value(ticket?.[column])),
      ])
    );
  const notes = sourceColumns.flatMap((column) =>
    splitNoteEntries(ticket?.[column])
      .map((entry, index) => {
        const cleanedBody = normalizeNoteDisplayContent(cleanNoteBody(entry));
        const author = extractAuthor(entry);
        const type = extractNoteType(entry, column === 'combined_notes' ? 'Combined Notes' : formatLabel(column));

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

  if (combinedNotes && !notes.length) {
    return [
      {
        id: 'combined-notes-0',
        label: 'Combined Notes',
        type: 'Combined Notes',
        value: combinedNotes,
        content: combinedNotes,
        timestamp: null,
        author: '',
      },
    ];
  }

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
  const updatedAt = parseDate(ticket?.updated_at) || parseDate(ticket?.[fieldMap.updated]) || lastNote?.timestamp || null;
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
  const rawTicket = ticket?.raw && typeof ticket.raw === 'object' ? ticket.raw : null;
  const metadataSource = rawTicket && Object.keys(rawTicket).length ? rawTicket : ticket;
  const metadataColumns = Object.keys(metadataSource || {});
  const metadataEntries = metadataColumns
    .filter((column) => !fieldMap.noteColumns.includes(column) && !isSuppressedTicketColumn(column))
    .filter((column) => !['ticket_id', 'title', 'status', 'assignee', 'priority', 'opened_at', 'updated_at', 'combined_notes', 'raw'].includes(column))
    .map((column) => [formatLabel(column), normalizeValue(metadataSource?.[column])])
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
      ['priority', normalizeValue(ticket?.priority)],
      ['opened_at', normalizeValue(ticket?.opened_at)],
      ['updated_at', normalizeValue(ticket?.updated_at)],
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
    'work Notes:',
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

  return dataset.rows.find((row) => normalizeValue(row?.ticket_id) === ticketId || getTicketId(row, dataset.columns) === ticketId) || null;
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
