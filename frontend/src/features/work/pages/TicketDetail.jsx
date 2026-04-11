import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock3, MessageSquareText, Sparkles, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getTicket, sendAiChat } from '../../../app/services/api';
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

export function TicketDetail() {
  const { ticketId: routeTicketId = '' } = useParams();
  const decodedTicketId = decodeURIComponent(routeTicketId);
  const [dataset, setDataset] = useState(() => getCachedWorkDataset());
  const [analysisResult, setAnalysisResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);

  const ticket = useMemo(() => findTicketById(dataset, decodedTicketId), [dataset, decodedTicketId]);
  const columns = dataset?.columns || [];
  const notes = useMemo(() => (ticket ? getTicketNotes(ticket, columns) : []), [ticket, columns]);
  const metadataEntries = useMemo(() => (ticket ? buildMetadataEntries(ticket, columns) : []), [ticket, columns]);
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
            description={error || 'Upload or reopen a CSV from the Work page before opening a ticket detail view.'}
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

      {(loading || analysisResult || error) ? (
        <Card className="ticket-summary-popup">
          <CardHeader eyebrow="AI Summary" title="Ticket summary" />
          {loading ? <p className="status-text">Loading analysis...</p> : null}
          {error ? <p className="status-text status-text--error">{error}</p> : null}
          {!loading && analysisResult ? (
            <div className="ticket-summary-popup__content">
              <div className="ticket-summary-popup__section">
                <span>Summary</span>
                <p>{parsedAnalysis.summary || 'No summary returned.'}</p>
              </div>
              <div className="ticket-summary-popup__section">
                <span>Work Notes</span>
                {parsedAnalysis.workNotes.length ? (
                  <ul>
                    {parsedAnalysis.workNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No work notes returned.</p>
                )}
              </div>
              <div className="ticket-summary-popup__section">
                <span>Comments</span>
                {parsedAnalysis.comments.length ? (
                  <ul>
                    {parsedAnalysis.comments.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No comments returned.</p>
                )}
              </div>
              <div className="ticket-summary-popup__section">
                <span>Status</span>
                <p>{parsedAnalysis.status || 'No status returned.'}</p>
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
