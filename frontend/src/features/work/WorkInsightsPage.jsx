import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, FolderKanban, MessageSquareText, Tags, UserRoundCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { sendAiChat } from '../../app/services/api';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { getCachedAiMetricSummary, getCachedWorkDataset, setCachedAiMetricSummary } from './workDatasetCache';
import { buildInsights } from './workInsightsMetrics';

function MetricTile({ label, value, detail }) {
  return (
    <article className="insights-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RankedList({ items, emptyText, secondaryKey }) {
  if (!items.length) {
    return <p className="insights-section__empty">{emptyText}</p>;
  }

  return (
    <div className="insights-list">
      {items.map((item) => (
        <div className="insights-list__row" key={`${item.label}-${item.count ?? item.id}`}>
          <div>
            <strong>{item.label || item.id}</strong>
            {secondaryKey ? <small>{item[secondaryKey]}</small> : null}
          </div>
          <span>{item.count ?? item.state}</span>
        </div>
      ))}
    </div>
  );
}

export function WorkInsightsPage() {
  const location = useLocation();
  const goBack = useBackNavigation('/app/work/active-tickets');
  const backLabel = location.state?.label || 'Active Tickets';
  const dataset = getCachedWorkDataset();
  const insights = useMemo(() => (dataset?.rows?.length ? buildInsights(dataset) : null), [dataset]);
  const summaryCacheKey = dataset?.analysisId || dataset?.fileName || '';
  const [aiSummary, setAiSummary] = useState(() => getCachedAiMetricSummary(summaryCacheKey));
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  useEffect(() => {
    setAiSummary(getCachedAiMetricSummary(summaryCacheKey));
    setSummaryError('');
  }, [summaryCacheKey]);

  async function handleGenerateSummary() {
    if (!dataset?.rows?.length || !insights || !summaryCacheKey) {
      return;
    }

    setSummaryError('');
    setIsSummaryLoading(true);

    try {
      const result = await sendAiChat({
        analysis_mode: 'full_dataset',
        dataset: {
          fileName: dataset.fileName,
          columns: dataset.columns,
          rows: dataset.rows,
        },
      });
      const message = result.message || result.summary || '';
      setAiSummary(message);
      setCachedAiMetricSummary(summaryCacheKey, message);
    } catch (error) {
      setAiSummary('');
      setSummaryError(error.message || 'Summary could not be generated.');
    } finally {
      setIsSummaryLoading(false);
    }
  }

  if (!dataset?.rows?.length) {
    return (
      <section className="module">
        <SectionHeader
          tag="/app/work/ai-metrics"
          title="AI Metrics"
          description="Advanced ticket metrics from the full CSV dataset."
        />
        <div className="insights-empty">
          <EmptyState
            icon={<FolderKanban size={20} />}
            title="Full dataset not loaded"
            description="Upload and analyze a CSV from the Work page first to build advanced insights from the full dataset."
          />
          <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
            {`Back to ${backLabel}`}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/work/ai-metrics"
        title="AI Metrics"
        description={`Advanced ticket metrics from ${dataset.fileName}.`}
        actions={
          <button className="ui-button ui-button--secondary" onClick={goBack} type="button">
            {`Back to ${backLabel}`}
          </button>
        }
      />

      <section className="insights-section">
        <div className="insights-summary-box">
          <div className="insights-section__header">
            <div className="insights-section__title">
              <MessageSquareText size={16} />
              <h3>AI Summary</h3>
            </div>
            <button className="compact-toggle" disabled={isSummaryLoading} onClick={handleGenerateSummary} type="button">
              {isSummaryLoading ? 'Generating...' : aiSummary ? 'Re-run Summary' : 'Generate Summary'}
            </button>
          </div>
          <p>{isSummaryLoading ? 'Generating summary from metrics...' : aiSummary || 'Summary unavailable.'}</p>
          {summaryError ? <p className="status-text status-text--error">{summaryError}</p> : null}
        </div>
      </section>

      <section className="insights-section">
        <div className="insights-section__header">
          <div className="insights-section__title">
            <AlertTriangle size={16} />
            <h3>Overview</h3>
          </div>
        </div>
        <div className="insights-grid">
          {insights.summaryMetrics.map((metric) => (
            <MetricTile key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      <section className="insights-section">
        <div className="insights-section__header">
          <div className="insights-section__title">
            <Clock3 size={16} />
            <h3>Activity</h3>
          </div>
        </div>
        <div className="insights-grid insights-grid--split">
          <div className="insights-panel">
            <h4>Tickets by State</h4>
            <RankedList emptyText="No state data available." items={insights.stateBreakdown} />
          </div>
          <div className="insights-panel">
            <h4>Oldest Open Tickets</h4>
            {insights.oldestOpenTickets.length ? (
              <div className="insights-list">
                {insights.oldestOpenTickets.map((ticket) => (
                  <div className="insights-list__row" key={ticket.id}>
                    <div>
                      <strong>{ticket.id}</strong>
                      <small>{ticket.assignee}</small>
                    </div>
                    <span>{ticket.openedAt}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="insights-section__empty">No open tickets available.</p>
            )}
          </div>
        </div>
      </section>

      <section className="insights-section">
        <div className="insights-section__header">
          <div className="insights-section__title">
            <UserRoundCheck size={16} />
            <h3>Ownership</h3>
          </div>
        </div>
        <div className="insights-grid insights-grid--split">
          <div className="insights-panel">
            <h4>Closed Tickets by Assignee</h4>
            <RankedList emptyText="No closed tickets available." items={insights.closedByAssignee} />
          </div>
          <div className="insights-panel">
            <h4>Most Active Assignees</h4>
            <RankedList emptyText="No assignee data available." items={insights.activeAssignees} />
          </div>
        </div>
      </section>

      <section className="insights-section">
        <div className="insights-section__header">
          <div className="insights-section__title">
            <Tags size={16} />
            <h3>Data Quality</h3>
          </div>
        </div>
        <div className="insights-grid insights-grid--split">
          <div className="insights-panel">
            <h4>Most Common Keywords</h4>
            {insights.keywords.length ? (
              <div className="keyword-pills">
                {insights.keywords.map((keyword) => (
                  <span className="keyword-pill" key={keyword.label}>
                    {keyword.label}
                    <strong>{keyword.count}</strong>
                  </span>
                ))}
              </div>
            ) : (
              <p className="insights-section__empty">No keyword data available.</p>
            )}
          </div>
          <div className="insights-panel">
            <h4>Field Coverage</h4>
            <div className="insights-grid">
              {insights.dataQuality.map((metric) => (
                <MetricTile key={metric.label} {...metric} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
