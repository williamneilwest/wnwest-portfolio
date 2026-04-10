import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, MessageSquareText, Sparkles, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { sendAiChat } from '../../../app/services/api';
import { Card, CardHeader } from '../../../app/ui/Card';
import { EmptyState } from '../../../app/ui/EmptyState';
import { getCachedWorkDataset, setCachedWorkDataset } from '../workDatasetCache';
import {
  build_prompt,
  findTicketById,
  getTicketAssignee,
  getTicketId,
  getTicketLastUpdatedLabel,
  getTicketNotes,
  getTicketStatus,
  getTicketTitle,
  getTicketColumns,
  isSuppressedTicketColumn,
  get_last_update_info,
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
  const hasAutoAnalyzedRef = useRef(false);

  const ticket = useMemo(() => findTicketById(dataset, decodedTicketId), [dataset, decodedTicketId]);
  const columns = dataset?.columns || [];
  const notes = useMemo(() => (ticket ? getTicketNotes(ticket, columns) : []), [ticket, columns]);
  const metadataEntries = useMemo(() => (ticket ? buildMetadataEntries(ticket, columns) : []), [ticket, columns]);
  const parsedAnalysis = useMemo(
    () => parseTicketAiAnalysis(analysisResult),
    [analysisResult]
  );

  useEffect(() => {
    hasAutoAnalyzedRef.current = false;
  }, [decodedTicketId]);

  useEffect(() => {
    setAnalysisResult(ticket?.ai_analysis?.result || '');
  }, [ticket?.ai_analysis?.result]);

  async function runAnalysis() {
    if (!ticket) {
      return;
    }

    setError('');
    setLoading(true);
    const startedAt = performance.now();

    try {
      const { days_since, last_author, last_type } = get_last_update_info(ticket, columns);
      const prompt = build_prompt(ticket, days_since, last_author, last_type);
      const result = await sendAiChat(prompt);
      const message = result.message || '';
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

  useEffect(() => {
    if (!ticket || hasAutoAnalyzedRef.current) {
      return;
    }

    hasAutoAnalyzedRef.current = true;
    void runAnalysis();
  }, [ticket]);

  if (!dataset?.rows?.length) {
    return (
      <section className="module">
        <Card className="module__empty-card">
          <EmptyState
            icon={<MessageSquareText size={20} />}
            title="No ticket dataset loaded"
            description="Upload or reopen a CSV from the Work page before opening a ticket detail view."
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
            description="The selected ticket is not present in the currently cached dataset."
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="module">
      <div className="ticket-detail__topbar">
        <Link className="compact-toggle" to="/work">
          <ArrowLeft size={15} />
          Back to Work
        </Link>
      </div>

      <section className="ticket-detail-layout">
        <div className="ticket-detail-main">
          <Card className="ticket-detail-card">
            <CardHeader eyebrow="Ticket Detail" title={getTicketId(ticket, columns)} description={getTicketTitle(ticket, columns)} />

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

          <Card className="ticket-detail-card ticket-analysis-card">
            <CardHeader
              eyebrow="AI Analysis"
              title="Ticket review"
              description="Run a targeted analysis for this ticket using the existing AI gateway."
              action={
                <button className="ui-button ui-button--primary" disabled={loading} onClick={runAnalysis} type="button">
                  <Sparkles size={16} />
                  {loading
                    ? 'Analyzing...'
                    : ticket?.ai_analysis?.result
                      ? 'Re-run Analysis'
                      : 'Analyze with AI'}
                </button>
              }
            />

            {error ? <p className="status-text status-text--error">{error}</p> : null}
            {loading ? <p className="status-text">Analyzing ticket...</p> : null}

            {analysisResult ? (
              <div className="ticket-analysis-grid">
                <div className="ticket-analysis-grid__item ticket-analysis-grid__item--wide">
                  <span>Summary</span>
                  <p>{parsedAnalysis.summary || 'No summary returned.'}</p>
                </div>
                <div className="ticket-analysis-grid__item">
                  <span>Root cause</span>
                  <p>{parsedAnalysis.rootCause || 'No root cause identified.'}</p>
                </div>
                <div className="ticket-analysis-grid__item">
                  <span>Work performed</span>
                  <p>{parsedAnalysis.workPerformed || 'No work performed listed.'}</p>
                </div>
                <div className="ticket-analysis-grid__item">
                  <span>Blocker</span>
                  <p>{parsedAnalysis.blocker || 'No blocker identified.'}</p>
                </div>
                <div className="ticket-analysis-grid__item">
                  <span>Next step</span>
                  <p>{parsedAnalysis.nextStep || 'No next step provided.'}</p>
                </div>
                <div className="ticket-analysis-grid__item">
                  <span>Stalled status</span>
                  <p>{parsedAnalysis.stalledStatus || 'No stalled status provided.'}</p>
                </div>
                <div className="ticket-analysis-grid__item ticket-analysis-grid__item--wide">
                  <span>Analysis metadata</span>
                  <p>
                    Version {ticket.ai_analysis.version} · {ticket.ai_analysis.duration_seconds}s ·{' '}
                    {new Date(ticket.ai_analysis.analyzed_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles size={20} />}
                title="No AI analysis yet"
                description="Analysis starts automatically when the ticket page loads."
              />
            )}
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
