import { FileJson, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAnalyzedDocument, getAnalyzedDocuments } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { formatDataFileName } from '../../app/utils/fileDisplay';

function formatWhen(value) {
  if (!value) {
    return 'Time unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Time unavailable';
  }

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDisplayPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const structured = payload.ai_structured;
  if (structured && typeof structured === 'object' && Object.keys(structured).length > 0) {
    return structured;
  }

  return {
    summary: payload.ai_summary || 'No structured AI output available.',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    source: payload.source || '',
    file_type: payload.file_type || '',
    parsed_text_preview: String(payload.parsed_text || '').slice(0, 1000),
  };
}

function getDisplayBody(payload) {
  const raw = payload?.ai_structured?.raw_response;
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return JSON.stringify(getDisplayPayload(payload), null, 2);
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [selectedPayload, setSelectedPayload] = useState(null);

  useEffect(() => {
    let mounted = true;

    getAnalyzedDocuments()
      .then((result) => {
        if (mounted) {
          setDocuments(Array.isArray(result) ? result : []);
        }
      })
      .catch((requestError) => {
        if (mounted) {
          setError(requestError.message || 'Analyzed documents could not be loaded.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return documents;
    }

    return documents.filter((document) =>
      (Array.isArray(document.tags) ? document.tags : []).some((tag) => String(tag || '').toLowerCase().includes(normalizedQuery))
    );
  }, [documents, query]);

  async function handleOpen(document) {
    setSelectedDocument(document);
    setSelectedPayload(null);

    try {
      const payload = await getAnalyzedDocument(document.id);
      setSelectedPayload(payload && typeof payload === 'object' ? payload : {});
    } catch (requestError) {
      setError(requestError.message || 'Document details could not be loaded.');
    }
  }

  return (
    <section className="module">
      <SectionHeader tag="/app/ai/documents" title="AI Documents" description="Structured document analysis results available for future AI workflows." />

      {error ? <p className="status-text status-text--error">{error}</p> : null}

      <Card className="analysis-grid__wide">
        <CardHeader
          eyebrow="Documents"
          title="Analyzed Files"
          description="Search analyzed documents by tag and open the stored AI output."
        />

        <div className="toolbar" style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0 16px' }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by tag…"
            className="input"
            aria-label="Filter analyzed documents by tag"
            style={{ maxWidth: 360 }}
          />
        </div>

        {filteredDocuments.length ? (
          <div className="stack-list">
            {filteredDocuments.map((document) => (
              <button
                key={document.id}
                type="button"
                className="stack-row stack-row--interactive"
                onClick={() => void handleOpen(document)}
              >
                <span className="stack-row__label">
                  <FileJson size={16} />
                  <span>
                    <strong>{formatDataFileName(document.filename)}</strong>
                    <small>{formatWhen(document.created_at)}</small>
                    <small>{document.ai_summary || 'No AI summary available.'}</small>
                    {Array.isArray(document.tags) && document.tags.length ? (
                      <span style={{ display: 'block', marginTop: 4 }}>
                        {document.tags.map((tag) => (
                          <span key={`${document.id}-${tag}`} className="badge" style={{ marginRight: 6 }}>{tag}</span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Search size={20} />}
            title="No analyzed documents yet"
            description="Analyze an uploaded file to create structured JSON and reusable tags."
          />
        )}
      </Card>

      {selectedDocument ? (
        <div className="row-detail-backdrop" onClick={() => setSelectedDocument(null)} role="presentation">
          <aside aria-label="Analyzed document details" className="row-detail-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="row-detail-drawer__header">
              <div className="row-detail-drawer__title">
                <span className="ui-eyebrow">AI Document</span>
                <h3>{formatDataFileName(selectedDocument.filename)}</h3>
                <p>{selectedDocument.ai_summary || 'Structured analysis output'}</p>
              </div>
              <button className="compact-toggle compact-toggle--icon" onClick={() => setSelectedDocument(null)} type="button">
                <X size={15} />
              </button>
            </div>

            <div className="row-detail-drawer__content">
              <pre className="code-block">{getDisplayBody(selectedPayload)}</pre>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
