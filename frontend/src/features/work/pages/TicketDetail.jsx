import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock3, MessageSquareText, ShieldCheck, ShieldX, Sparkles, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getReferenceGroups, getReferenceUsers, getTicket, getUserGroups, sendAiChat } from '../../../app/services/api';
import { Card, CardHeader } from '../../../app/ui/Card';
import { EmptyState } from '../../../app/ui/EmptyState';
import { getCachedWorkDataset, setCachedWorkDataset } from '../workDatasetCache';
import {
  findTicketById,
  getTicketAssignee,
  getTicketId,
  getTicketLastUpdatedLabel,
  getTicketNotes,
  getTicketStatus,
  getTicketTitle,
  getTicketColumns,
  isSuppressedTicketColumn,
  parseTicketAiAnalysis,
  updateTicketAnalysis,
} from '../utils/aiAnalysis';
import { buildTicketRuleText, matchTicketRules } from '../utils/ticketRules';

const USER_LOOKUP_PATTERNS = [
  /opid/i,
  /requested?_?for/i,
  /opened_?by/i,
  /caller/i,
  /requester/i,
  /employee_?id/i,
  /user_?id/i,
  /username/i,
  /login/i,
  /email/i,
];
const OPID_PATTERN = /^[a-z]{2,}[a-z0-9]{2,}$/i;

function buildMetadataEntries(ticket, columns) {
  const fieldMap = getTicketColumns(columns);
  const excluded = new Set([fieldMap.id, fieldMap.title, fieldMap.assignee, fieldMap.status, ...fieldMap.noteColumns].filter(Boolean));

  return columns
    .filter((column) => !excluded.has(column) && !isSuppressedTicketColumn(column))
    .map((column) => ({
      label: column.replace(/[_-]+/g, ' '),
      value: String(ticket?.[column] ?? '').trim() || 'Unknown',
    }))
    .filter((item) => item.value && item.value !== 'Unknown');
}

function normalizeLookupValue(value) {
  return String(value ?? '').trim();
}

function normalizeComparisonValue(value) {
  return normalizeLookupValue(value).toLowerCase();
}

function normalizeCanonicalGroupKey(value) {
  return normalizeComparisonValue(value).replace(/[^a-z0-9]+/g, '');
}

function getAssociatedGroupNames(rule) {
  const tags = Array.isArray(rule?.associatedGroupTags) ? rule.associatedGroupTags : [];

  return tags
    .map((tag) => normalizeLookupValue(tag))
    .map((tag) => (tag.toLowerCase().startsWith('group:') ? tag.slice('group:'.length) : tag))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function resolveTaggedGroups(referenceGroups, associatedGroupNames) {
  const groupRows = Array.isArray(referenceGroups) ? referenceGroups : [];
  const matchedGroups = [];
  const seenIds = new Set();

  associatedGroupNames.forEach((groupName) => {
    const normalizedGroupName = normalizeComparisonValue(groupName);
    const canonicalGroupName = normalizeCanonicalGroupKey(groupName);

    const matchedGroup = groupRows.find((group) => {
      const idNorm = normalizeComparisonValue(group?.id);
      const idCanon = normalizeCanonicalGroupKey(group?.id);

      const nameNorm = normalizeComparisonValue(group?.name);
      const nameCanon = normalizeCanonicalGroupKey(group?.name);

      // Parse optional aliases from tags field. Accept common delimiters.
      const rawTags = String(group?.tags ?? '');
      const tagParts = rawTags
        .split(/[,;|\n]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const tagNormSet = new Set(tagParts.map((t) => normalizeComparisonValue(t)));
      const tagCanonSet = new Set(tagParts.map((t) => normalizeCanonicalGroupKey(t)));

      return (
        // Direct id match
        idNorm === normalizedGroupName || (canonicalGroupName && idCanon === canonicalGroupName)
      ) || (
        // Name match (existing behavior)
        nameNorm === normalizedGroupName || (canonicalGroupName && nameCanon === canonicalGroupName)
      ) || (
        // Match any aliases provided in tags
        tagNormSet.has(normalizedGroupName) || (canonicalGroupName && tagCanonSet.has(canonicalGroupName))
      );
    });

    if (matchedGroup?.id && !seenIds.has(matchedGroup.id)) {
      matchedGroups.push(matchedGroup);
      seenIds.add(matchedGroup.id);
    }
  });

  return matchedGroups;
}

function getUserLookupCandidates(ticket, columns) {
  const values = [];

  columns.forEach((column) => {
    if (!USER_LOOKUP_PATTERNS.some((pattern) => pattern.test(column))) {
      return;
    }

    const value = normalizeLookupValue(ticket?.[column]);
    if (value) {
      values.push(value);
    }
  });

  const assignee = normalizeLookupValue(getTicketAssignee(ticket, columns));
  if (assignee && assignee !== 'Unassigned') {
    values.push(assignee);
  }

  return Array.from(new Set(values));
}

function resolveUserOpid(candidates, users) {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeLookupValue(candidate).toLowerCase();
    if (!normalizedCandidate) {
      continue;
    }

    const matchedUser = users.find((user) => {
      const userId = normalizeLookupValue(user?.id).toLowerCase();
      const userName = normalizeLookupValue(user?.name).toLowerCase();
      const userEmail = normalizeLookupValue(user?.email).toLowerCase();

      return normalizedCandidate === userId
        || normalizedCandidate === userName
        || normalizedCandidate === userEmail;
    });

    if (matchedUser?.id) {
      return matchedUser.id;
    }

    if (OPID_PATTERN.test(candidate) && !candidate.includes('@') && !candidate.includes(' ')) {
      return candidate;
    }
  }

  return '';
}

export function TicketDetail() {
  const { ticketId: routeTicketId = '' } = useParams();
  const decodedTicketId = decodeURIComponent(routeTicketId);
  const [dataset, setDataset] = useState(() => getCachedWorkDataset());
  const [analysisResult, setAnalysisResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);
  const [responderAccess, setResponderAccess] = useState({
    loading: false,
    error: '',
    userOpid: '',
    groups: [],
    taggedGroups: [],
    hasResponderGroup: false,
    matchedGroup: '',
  });

  const ticket = useMemo(() => findTicketById(dataset, decodedTicketId), [dataset, decodedTicketId]);
  const columns = dataset?.columns || [];
  const notes = useMemo(() => (ticket ? getTicketNotes(ticket, columns) : []), [ticket, columns]);
  const metadataEntries = useMemo(() => (ticket ? buildMetadataEntries(ticket, columns) : []), [ticket, columns]);
  const matchedRules = useMemo(() => {
    if (!ticket) {
      return [];
    }

    return matchTicketRules(buildTicketRuleText(ticket, columns));
  }, [ticket, columns]);
  const responderRule = useMemo(
    () => matchedRules.find((rule) => rule.id === 'responder_group') || null,
    [matchedRules]
  );
  const userLookupCandidates = useMemo(
    () => (ticket ? getUserLookupCandidates(ticket, columns) : []),
    [ticket, columns]
  );
  const parsedAnalysis = useMemo(
    () => parseTicketAiAnalysis(analysisResult),
    [analysisResult]
  );

  useEffect(() => {
    setAnalysisResult(ticket?.ai_analysis?.result || '');
  }, [ticket?.ai_analysis?.result]);

  useEffect(() => {
    let isMounted = true;

    async function loadTicket() {
      if (ticket) {
        return;
      }

      setIsLoadingTicket(true);
      setError('');

      try {
        const result = await getTicket(decodedTicketId);

        if (!isMounted) {
          return;
        }

        const nextDataset = {
          columns: Object.keys(result.data || {}),
          rows: result.data ? [result.data] : [],
        };

        setCachedWorkDataset(nextDataset);
        setDataset(nextDataset);
      } catch (requestError) {
        if (!isMounted) {
          return;
        }

        setError(requestError.message || 'Ticket could not be loaded.');
      } finally {
        if (isMounted) {
          setIsLoadingTicket(false);
        }
      }
    }

    void loadTicket();

    return () => {
      isMounted = false;
    };
  }, [decodedTicketId, ticket]);

  useEffect(() => {
    let isMounted = true;

    async function loadResponderAccess() {
      if (!ticket || !responderRule) {
        setResponderAccess({
          loading: false,
          error: '',
          userOpid: '',
          groups: [],
          taggedGroups: [],
          hasResponderGroup: false,
          matchedGroup: '',
        });
        return;
      }

      setResponderAccess((current) => ({
        ...current,
        loading: true,
        error: '',
        groups: [],
        taggedGroups: [],
        hasResponderGroup: false,
        matchedGroup: '',
      }));

      try {
        const [users, referenceGroups] = await Promise.all([getReferenceUsers(), getReferenceGroups()]);
        if (!isMounted) {
          return;
        }

        const associatedGroupNames = getAssociatedGroupNames(responderRule);
        const taggedGroups = resolveTaggedGroups(referenceGroups, associatedGroupNames);

        if (!taggedGroups.length) {
          setResponderAccess({
            loading: false,
            error: associatedGroupNames.length
              ? `Responder tag found, but no cached groups matched: ${associatedGroupNames.join(', ')}.`
              : 'Responder tag found, but no associated cached groups were configured for this rule.',
            userOpid: '',
            groups: [],
            taggedGroups: [],
            hasResponderGroup: false,
            matchedGroup: '',
          });
          return;
        }

        const resolvedUserOpid = resolveUserOpid(userLookupCandidates, Array.isArray(users) ? users : []);
        if (!resolvedUserOpid) {
          setResponderAccess({
            loading: false,
            error: 'Responder tag found, but no ticket user could be resolved to an OPID.',
            userOpid: '',
            groups: [],
            taggedGroups,
            hasResponderGroup: false,
            matchedGroup: '',
          });
          return;
        }

        const response = await getUserGroups(resolvedUserOpid);
        if (!isMounted) {
          return;
        }

        const groups = Array.isArray(response?.items) ? response.items : [];
        const taggedGroupIds = new Set(taggedGroups.map((group) => normalizeLookupValue(group?.id)).filter(Boolean));
        const matchedGroup = groups.find((group) => taggedGroupIds.has(normalizeLookupValue(group?.id)));

        setResponderAccess({
          loading: false,
          error: '',
          userOpid: resolvedUserOpid,
          groups,
          taggedGroups,
          hasResponderGroup: Boolean(matchedGroup),
          matchedGroup: matchedGroup?.name || matchedGroup?.id || '',
        });
      } catch (requestError) {
        if (!isMounted) {
          return;
        }

        setResponderAccess({
          loading: false,
          error: requestError.message || 'Responder access check failed.',
          userOpid: '',
          groups: [],
          taggedGroups: [],
          hasResponderGroup: false,
          matchedGroup: '',
        });
      }
    }

    void loadResponderAccess();

    return () => {
      isMounted = false;
    };
  }, [ticket, responderRule, userLookupCandidates]);

  async function runAnalysis() {
    if (!ticket) {
      return;
    }

    setError('');
    setLoading(true);
    const startedAt = performance.now();

    try {
      const result = await sendAiChat({
        analysis_mode: 'deep',
        ticket,
        fileName: dataset?.fileName,
      });
      const message = result.message || result.summary || '';
      const durationSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(2));
      const nextAnalysis = {
        result: message,
        analyzed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        version: Number(ticket?.ai_analysis?.version || 0) + 1,
      };
      const nextDataset = updateTicketAnalysis(dataset, decodedTicketId, nextAnalysis);

      setAnalysisResult(message);
      setCachedWorkDataset(nextDataset);
      setDataset(nextDataset);
    } catch (requestError) {
      setError(requestError.message || 'AI analysis could not be completed.');
    } finally {
      setLoading(false);
    }
  }

  if (isLoadingTicket) {
    return (
      <section className="module">
        <Card className="module__empty-card">
          <EmptyState
            icon={<MessageSquareText size={20} />}
            title="Loading ticket"
            description="Retrieving ticket data from the backend."
          />
        </Card>
      </section>
    );
  }

  if (!dataset?.rows?.length) {
    return (
      <section className="module">
        <Card className="module__empty-card">
          <EmptyState
            icon={<MessageSquareText size={20} />}
            title="No ticket dataset loaded"
            description={error || 'Upload or reopen a CSV from the work page before opening a ticket detail view.'}
          />
        </Card>
      </section>
    );
  }

  if (!ticket) {
    return (
      <section className="module">
        <Card className="module__empty-card">
          <EmptyState
            icon={<MessageSquareText size={20} />}
            title="Ticket not found"
            description={error || 'The selected ticket is not present in the currently cached dataset.'}
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="module">
      <div className="ticket-detail__topbar">
        <Link className="compact-toggle" to="/app/work/active-tickets">
          <ArrowLeft size={15} />
          Back to Active Tickets
        </Link>
      </div>

      {responderRule ? (
        <Card className="ticket-tag-banner">
          <CardHeader
            eyebrow="Tag Detected"
            title="Tagged with Responder"
            description={responderRule.suggestion}
            action={
              responderAccess.hasResponderGroup ? (
                <span className="ticket-tag-banner__icon ticket-tag-banner__icon--success">
                  <ShieldCheck size={16} />
                </span>
              ) : (
                <span className="ticket-tag-banner__icon ticket-tag-banner__icon--warning">
                  <ShieldX size={16} />
                </span>
              )
            }
          />

          <div className="ticket-tag-banner__content">
            <div className="ticket-source-banner ticket-source-banner--compact">
              <span className="ticket-source-banner__pill">Responder</span>
              <span>
                {responderAccess.userOpid
                  ? `Resolved user OPID: ${responderAccess.userOpid}`
                  : userLookupCandidates.length
                    ? `Ticket user candidates: ${userLookupCandidates.join(', ')}`
                    : 'No ticket user fields were detected.'}
              </span>
              {responderAccess.taggedGroups.length ? (
                <span>
                  {`Tagged groups: ${responderAccess.taggedGroups.map((group) => `${group.name || group.id} (${group.id})`).join(', ')}`}
                </span>
              ) : null}
            </div>

            {responderAccess.loading ? <p className="status-text">Checking responder group access...</p> : null}
            {responderAccess.error ? <p className="status-text status-text--error">{responderAccess.error}</p> : null}
            {!responderAccess.loading && !responderAccess.error && responderAccess.userOpid ? (
              <p className="ticket-tag-banner__status">
                {responderAccess.hasResponderGroup
                  ? `Success. User has a tagged group${responderAccess.matchedGroup ? `: ${responderAccess.matchedGroup}` : ''}.`
                  : 'No tagged group IDs were found in the returned user group list.'}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {(loading || analysisResult || error) ? (
        <Card className="ticket-summary-popup">
          <CardHeader eyebrow="AI Summary" title="Ticket summary" />
          {loading ? <p className="status-text">Loading analysis...</p> : null}
          {error ? <p className="status-text status-text--error">{error}</p> : null}
          {!loading && analysisResult ? (
            <div className="ticket-summary-popup__content">
              <div className="ticket-summary-popup__section">
                <span>Summary</span>
                  <p>{analysisResult}</p>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <section className="ticket-detail-layout">
        <div className="ticket-detail-main">
          <Card className="ticket-detail-card">
            <CardHeader
              eyebrow="Ticket Detail"
              title={getTicketId(ticket, columns)}
              description={getTicketTitle(ticket, columns)}
              action={
                <button className="ui-button ui-button--primary" disabled={loading} onClick={runAnalysis} type="button">
                  <Sparkles size={16} />
                  {loading
                    ? 'Analyzing...'
                    : ticket?.ai_analysis?.result
                      ? 'Re-run Summary'
                      : 'Generate Summary'}
                </button>
              }
            />

            <div className="ticket-detail-hero">
              <div className="ticket-detail-hero__item">
                <UserRound size={14} />
                <span>{getTicketAssignee(ticket, columns)}</span>
              </div>
              <div className="ticket-detail-hero__item">
                <Clock3 size={14} />
                <span>{getTicketLastUpdatedLabel(ticket, columns)}</span>
              </div>
              <div className="ticket-detail-hero__item">
                <span className="ticket-card__status">{getTicketStatus(ticket, columns)}</span>
              </div>
            </div>

            <div className="ticket-detail-grid">
              {metadataEntries.map((item) => (
                <div className="ticket-detail-grid__item" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="ticket-notes-card">
          <CardHeader eyebrow="Notes" title="Combined Notes" description="A single readable stream of comments and work notes." />
          {notes.length ? (
            <div className="ticket-notes-stream">
              {notes.map((note) => (
                <article className="ticket-note" key={note.id}>
                  <p className="ticket-note__lead">
                    <strong>{note.author || 'Unknown author'}</strong>
                    {' · '}
                    <span>{note.type || 'Update'}</span>
                    {' · '}
                    <span>{note.timestamp ? note.timestamp.toLocaleString() : 'Unknown time'}</span>
                  </p>
                  <p>{note.value}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="row-notes-empty">No notes available</div>
          )}
        </Card>
      </section>
    </section>
  );
}
