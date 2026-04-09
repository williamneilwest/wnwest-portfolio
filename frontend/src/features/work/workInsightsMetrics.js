const STOPWORDS = [
  'a', 'the', 'and', 'or', 'is', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'an', 'be', 'this', 'that', 'it', 'as', 'are', 'was', 'were', 'from',
  'request', 'requesting', 'requested', 'requests',
  'not', 'working', 'task', 'room', 'service', 'installation', 'sourcing',
  'issue', 'issues', 'problem', 'problems', 'incident', 'incidents',
  'case', 'cases', 'ticket', 'tickets', 'support', 'help',
  'failure', 'failures', 'outage', 'outages', 'error', 'errors',
  'broken'
];

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function lowerValue(value) {
  return normalizeValue(value).toLowerCase();
}

function parseDate(value) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function getColumn(columns, patterns) {
  return columns.find((column) => patterns.some((pattern) => pattern.test(column))) || '';
}

function isClosedState(value) {
  const normalized = lowerValue(value);
  return /closed|resolved|complete|completed|done|cancelled|canceled/.test(normalized);
}

function isOpenState(value) {
  const normalized = lowerValue(value);
  if (!normalized) {
    return true;
  }

  return !isClosedState(normalized);
}

function isHighPriority(value) {
  const normalized = lowerValue(value);
  return normalized === '1' || normalized === '2' || /critical|high/.test(normalized);
}

function countBy(rows, getKey) {
  const counts = new Map();

  for (const row of rows) {
    const key = getKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count);
}

function formatPercent(count, total) {
  if (!total) {
    return '0%';
  }

  return `${Math.round((count / total) * 100)}%`;
}

export function buildInsights(dataset) {
  const rows = dataset?.rows || [];
  const columns = dataset?.columns || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const stateColumn = getColumn(columns, [/^state$/i, /^status$/i]);
  const assigneeColumn = getColumn(columns, [/assigned_to/i, /assignee/i, /owner/i]);
  const updatedColumn = getColumn(columns, [/sys_updated_on/i, /updated/i]);
  const openedColumn = getColumn(columns, [/^opened_at$/i, /created_on/i, /sys_created_on/i, /opened/i]);
  const closedColumn = getColumn(columns, [/closed_at/i, /resolved_at/i, /closed_on/i, /resolved_on/i]);
  const shortDescriptionColumn = getColumn(columns, [/short_description/i, /subject/i, /title/i]);
  const priorityColumn = getColumn(columns, [/^priority$/i, /severity/i]);
  const ticketNumberColumn = getColumn(columns, [/number/i, /ticket/i, /case/i, /incident/i, /request/i, /^id$/i]);

  const staleTickets = rows.filter((row) => {
    const updatedAt = parseDate(row[updatedColumn]);
    return updatedAt && updatedAt < threeDaysAgo;
  });

  const closedTickets = rows.filter((row) => isClosedState(row[stateColumn]));
  const openTickets = rows.filter((row) => isOpenState(row[stateColumn]));

  const oldestOpenTickets = [...openTickets]
    .filter((row) => parseDate(row[openedColumn]))
    .sort((left, right) => parseDate(left[openedColumn]) - parseDate(right[openedColumn]))
    .slice(0, 5)
    .map((row) => ({
      id: normalizeValue(row[ticketNumberColumn]) || normalizeValue(row[shortDescriptionColumn]) || 'Untitled ticket',
      openedAt: normalizeValue(row[openedColumn]) || 'Unknown',
      assignee: normalizeValue(row[assigneeColumn]) || 'Unassigned',
      state: normalizeValue(row[stateColumn]) || 'Unknown',
    }));

  const keywordCounts = new Map();
  for (const row of rows) {
    const text = lowerValue(row[shortDescriptionColumn]);
    if (!text) {
      continue;
    }

    const tokens = text.match(/[a-z0-9]{3,}/g) || [];
    for (const token of tokens) {
      if (STOPWORDS.includes(token)) {
        continue;
      }
      keywordCounts.set(token, (keywordCounts.get(token) || 0) + 1);
    }
  }

  const keywords = [...keywordCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

  const unassignedTickets = rows.filter((row) => !normalizeValue(row[assigneeColumn]));
  const highPriorityTickets = rows.filter((row) => isHighPriority(row[priorityColumn]));
  const createdLast7Days = rows.filter((row) => {
    const openedAt = parseDate(row[openedColumn]);
    return openedAt && openedAt >= sevenDaysAgo;
  });
  const closedLast7Days = rows.filter((row) => {
    const closedAt = parseDate(row[closedColumn]);
    return closedAt && closedAt >= sevenDaysAgo;
  });

  return {
    summaryMetrics: [
      { label: 'Stale Tickets', value: staleTickets.length, detail: formatPercent(staleTickets.length, rows.length) },
      { label: 'Unassigned', value: unassignedTickets.length, detail: formatPercent(unassignedTickets.length, rows.length) },
      { label: 'High Priority', value: highPriorityTickets.length, detail: formatPercent(highPriorityTickets.length, rows.length) },
      { label: 'Created Last 7 Days', value: createdLast7Days.length, detail: 'Recent intake' },
      { label: 'Closed Last 7 Days', value: closedLast7Days.length, detail: 'Recent resolution' },
    ],
    stateBreakdown: countBy(rows, (row) => normalizeValue(row[stateColumn]) || 'Unknown'),
    closedByAssignee: countBy(closedTickets, (row) => normalizeValue(row[assigneeColumn]) || 'Unassigned'),
    activeAssignees: countBy(rows, (row) => normalizeValue(row[assigneeColumn]) || 'Unassigned'),
    oldestOpenTickets,
    keywords,
    dataQuality: [
      {
        label: 'Missing Assignee',
        value: unassignedTickets.length,
        detail: assigneeColumn || 'No assignee column',
      },
      {
        label: 'Missing Updated Date',
        value: rows.filter((row) => !parseDate(row[updatedColumn])).length,
        detail: updatedColumn || 'No updated column',
      },
      {
        label: 'Missing Opened Date',
        value: rows.filter((row) => !parseDate(row[openedColumn])).length,
        detail: openedColumn || 'No opened column',
      },
    ],
  };
}

export function buildInsightsSummaryPrompt(dataset, insights) {
  return [
    'You are an operations analyst.',
    'Summarize these ticket metrics in 4 short bullet points.',
    'Use only the metrics provided.',
    'Focus on backlog risk, ownership, recent activity, and one practical next step.',
    'Do not mention raw rows or speculate beyond the metrics.',
    '',
    `Dataset: ${dataset?.fileName || 'Unknown CSV'}`,
    `Rows: ${dataset?.rows?.length || 0}`,
    `Columns: ${dataset?.columns?.length || 0}`,
    `Summary metrics: ${insights.summaryMetrics.map((metric) => `${metric.label}=${metric.value} (${metric.detail})`).join('; ')}`,
    `State breakdown: ${insights.stateBreakdown.slice(0, 8).map((item) => `${item.label}=${item.count}`).join('; ') || 'None'}`,
    `Closed by assignee: ${insights.closedByAssignee.slice(0, 8).map((item) => `${item.label}=${item.count}`).join('; ') || 'None'}`,
    `Most active assignees: ${insights.activeAssignees.slice(0, 8).map((item) => `${item.label}=${item.count}`).join('; ') || 'None'}`,
    `Oldest open tickets: ${insights.oldestOpenTickets.map((ticket) => `${ticket.id} opened ${ticket.openedAt} assignee=${ticket.assignee}`).join('; ') || 'None'}`,
    `Keywords: ${insights.keywords.map((item) => `${item.label}=${item.count}`).join('; ') || 'None'}`,
    `Data quality: ${insights.dataQuality.map((item) => `${item.label}=${item.value}`).join('; ')}`,
  ].join('\n');
}
