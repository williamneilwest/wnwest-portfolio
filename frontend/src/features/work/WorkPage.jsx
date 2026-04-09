import { useEffect, useState } from 'react';
import { BarChart3, Clock3, FileSpreadsheet, History, Layers3, Sparkles, Upload } from 'lucide-react';
import { analyzeCsvFile, getRecentCsvAnalyses } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

export function WorkPage() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadRecentAnalyses() {
      try {
        const result = await getRecentCsvAnalyses();

        if (!isMounted) {
          return;
        }

        setRecentAnalyses(result.data || []);
      } catch {
        if (!isMounted) {
          return;
        }

        setRecentAnalyses([]);
      } finally {
        if (isMounted) {
          setIsLoadingRecent(false);
        }
      }
    }

    loadRecentAnalyses();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedFile) {
      setError('Select a CSV file before running the analyzer.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await analyzeCsvFile(selectedFile);
      setAnalysis(result.data);
      setRecentAnalyses((current) => {
        const next = [
          {
            id: result.data.analysisId,
            fileName: result.data.fileName,
            savedAt: result.data.savedAt,
            analysis: result.data,
          },
          ...current.filter((entry) => entry.id !== result.data.analysisId),
        ];

        return next.slice(0, 10);
      });
    } catch (requestError) {
      setAnalysis(null);
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/csv"
        title="Work"
        description="Use the CSV analyzer to turn operational exports into a quick read on volume, categories, and data quality."
        actions={
          <>
            <span className="module__action-pill">
              <Sparkles size={15} />
              Fast summary
            </span>
            <span className="module__action-pill">
              <Layers3 size={15} />
              No raw dump
            </span>
          </>
        }
      />

      <div className="work-layout">
        <Card tone="accent">
          <CardHeader
            eyebrow="CSV Analyzer"
            title="Inspect one export at a time"
            description="Upload one operational CSV at a time. The analyzer returns a useful signal layer instead of a raw data dump."
          />

          <form className="upload-form" onSubmit={handleSubmit}>
            <label className="upload-input">
              <div className="upload-input__summary">
                <span className="icon-badge icon-badge--accent">
                  <Upload size={16} />
                </span>
                <div>
                  <strong>{selectedFile ? selectedFile.name : 'Choose a CSV file'}</strong>
                  <span>Accepted format: `.csv`</span>
                </div>
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              />
            </label>

            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Analyzing...' : 'Analyze CSV'}
            </Button>
          </form>

          {error ? <p className="status-text status-text--error">{error}</p> : null}
        </Card>

        <Card>
          <CardHeader
            eyebrow="What it extracts"
            title="Signal, not noise"
            description="The response stays compact so this page reads like a control panel rather than a spreadsheet viewer."
          />
          <div className="feature-list">
            <div className="feature-list__item">
              <BarChart3 size={17} />
              <span>Row and column counts</span>
            </div>
            <div className="feature-list__item">
              <FileSpreadsheet size={17} />
              <span>Top category groupings</span>
            </div>
            <div className="feature-list__item">
              <Layers3 size={17} />
              <span>Column completeness signals</span>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          eyebrow="Recent analyses"
          title="Last 10 saved CSV runs"
          description="Stored on the backend so recent metrics survive refreshes and container restarts."
        />
        {recentAnalyses.length ? (
          <div className="stack-list">
            {recentAnalyses.map((entry) => (
              <button
                key={entry.id}
                className="stack-row stack-row--interactive"
                onClick={() => setAnalysis(entry.analysis)}
                type="button"
              >
                <span className="stack-row__label">
                  <History size={16} />
                  <span>
                    <strong>{entry.fileName}</strong>
                    <small>{new Date(entry.savedAt).toLocaleString()}</small>
                  </span>
                </span>
                <strong>{entry.analysis.rowCount} rows</strong>
              </button>
            ))}
          </div>
        ) : isLoadingRecent ? (
          <div className="skeleton-stack">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        ) : (
          <EmptyState
            icon={<Clock3 size={20} />}
            title="No saved analyses yet"
            description="Analyze a CSV once and the most recent 10 results will stay available here."
          />
        )}
      </Card>

      {analysis ? (
        <section className="analysis-grid">
          <Card>
            <CardHeader eyebrow="Overview" title="Dataset summary" />
            <div className="metric-grid">
              <div className="metric-tile">
                <span>Rows</span>
                <strong>{analysis.rowCount}</strong>
              </div>
              <div className="metric-tile">
                <span>Columns</span>
                <strong>{analysis.columnCount}</strong>
              </div>
              <div className="metric-tile">
                <span>Category field</span>
                <strong>{analysis.categoryColumn || 'None'}</strong>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Categories" title="Top categories" />
            {analysis.topCategories.length ? (
              <div className="stack-list">
                {analysis.topCategories.map((item) => (
                  <div className="stack-row" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>No category breakdown was available for this file.</p>
            )}
          </Card>

          <Card>
            <CardHeader eyebrow="Data quality" title="Column coverage" />
            <div className="stack-list">
              {analysis.columnCompleteness.map((item) => (
                <div className="stack-row" key={item.column}>
                  <span>{item.column}</span>
                  <strong>{item.filled} filled</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Insights" title="Operator readout" />
            <ul className="card__list">
              {analysis.insights.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
          </Card>
        </section>
      ) : (
        <Card className="module__empty-card">
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No dataset analyzed yet"
            description="Upload a CSV to see counts, categories, and a short data-quality readout."
          />
        </Card>
      )}
    </section>
  );
}
