import { useEffect, useMemo, useState } from 'react';
import { Folder, FileText, Download, Mail, ExternalLink, Printer, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { analyzeKbDocument, getKnowledgeBase } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { buildDocumentViewHref } from '../../app/utils/documentFiles';
import { EmptyState } from '../../app/ui/EmptyState';
import { formatDataFileName } from '../../app/utils/fileDisplay';

function formatWhen(value) {
  if (!value) return 'Time unavailable';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Time unavailable';
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function KnowledgeBasePage() {
  const [data, setData] = useState({ categories: [] });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    getKnowledgeBase()
      .then((payload) => {
        if (mounted) setData(payload && typeof payload === 'object' ? payload : { categories: [] });
      })
      .catch((e) => {
        if (mounted) setError(e.message || 'Knowledge Base could not be loaded.');
      });
    return () => { mounted = false; };
  }, []);

  const categories = useMemo(() => {
    const cats = Array.isArray(data.categories) ? data.categories : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return cats;
    // Client-side filter by tag or filename
    return cats
      .map((c) => ({
        ...c,
        files: (Array.isArray(c.files) ? c.files : []).filter((f) => {
          const nameHit = (f.filename || '').toLowerCase().includes(q);
          const tagHit = (Array.isArray(f.tags) ? f.tags : []).some((t) => String(t || '').toLowerCase().includes(q));
          return nameHit || tagHit;
        })
      }))
      .filter((c) => (c.files?.length || 0) > 0);
  }, [data, query]);

  function absoluteUrl(relative) {
    try {
      return new URL(relative, window.location.origin).toString();
    } catch {
      return relative;
    }
  }

  return (
    <section className="module">
      <Card className="analysis-grid__wide">
        <CardHeader
          eyebrow="Knowledge Base"
          title="Reference documents"
          description="Docs emailed to kb@mail.westos.dev are organized by category below."
        />

        {error ? <p className="status-text status-text--error">{error}</p> : null}
        {message ? <p className="status-text status-text--success">{message}</p> : null}

        <div className="toolbar" style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0 16px' }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by tag or filename…"
            className="input"
            aria-label="Filter knowledge base"
            style={{ maxWidth: 360 }}
          />
        </div>

        {categories.length === 0 ? (
          <EmptyState
            icon={<Folder size={20} />}
            title="No Knowledge Base docs yet"
            description="Send attachments to kb@mail.westos.dev to populate this list."
          />
        ) : (
          <div className="stack-list">
            {categories.map((cat) => (
              <div className="stack-row" key={cat.category}>
                <span className="stack-row__label">
                  <Folder size={16} />
                  <span>
                    <strong>{cat.category}</strong>
                    <small>{(cat.files?.length || 0)} files</small>
                  </span>
                </span>
                <div className="stack-row__actions" />
                {Array.isArray(cat.files) && cat.files.length > 0 ? (
                  <div className="nested-list">
                    {cat.files.map((file) => {
                      const previewHref = buildDocumentViewHref({
                        url: file.url,
                        fileName: file.filename,
                        mimeType: file.mimeType,
                        title: 'Knowledge Base',
                        backTo: '/app/kb',
                      });

                      return (
                      <div className="stack-row" key={file.filename}>
                        <span className="stack-row__label">
                          <FileText size={14} />
                          <span>
                            <strong>{formatDataFileName(file.originalName || file.filename)}</strong>
                            <small>{formatWhen(file.modifiedAt)}{file.mimeType ? ` • ${file.mimeType}` : ''}</small>
                            {Array.isArray(file.tags) && file.tags.length > 0 ? (
                              <span style={{ display: 'block', marginTop: 4 }}>
                                {file.tags.slice(0, 8).map((t) => (
                                  <span key={t} className="badge" style={{ marginRight: 6 }}>{t}</span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <div className="stack-row__actions">
                          <Link className="compact-toggle" to={previewHref}>
                            <ExternalLink size={14} />
                            Open
                          </Link>
                          <button
                            type="button"
                            className="compact-toggle"
                            disabled={submitting}
                            onClick={async () => {
                              setMessage('');
                              setError('');
                              setSubmitting(true);
                              try {
                                const result = await analyzeKbDocument(cat.category, file.filename);
                                const id = Number(result?.id || 0);
                                if (id > 0) {
                                  setMessage('Document analyzed. Opening details…');
                                  navigate(`/app/ai/documents/${id}`);
                                } else {
                                  setMessage('Document analyzed.');
                                }
                              } catch (e) {
                                setError(e?.message || 'Analyze failed');
                              } finally {
                                setSubmitting(false);
                              }
                            }}
                          >
                            {submitting ? 'Analyzing…' : 'Analyze'}
                          </button>
                          <button
                            type="button"
                            className="compact-toggle"
                            onClick={() => {
                              const url = absoluteUrl(file.url);
                              const subject = encodeURIComponent(`KB: ${formatDataFileName(file.originalName || file.filename)}`);
                              const body = encodeURIComponent(`Quick reference link:\n${url}`);
                              window.location.href = `mailto:?subject=${subject}&body=${body}`;
                            }}
                          >
                            <Mail size={14} />
                            Email
                          </button>
                          <a className="compact-toggle" href={file.url} download={file.filename}>
                            <Download size={14} />
                            Download
                          </a>
                          <a className="compact-toggle" href={file.url} target="_blank" rel="noreferrer">
                            <Printer size={14} />
                            Print
                          </a>
                        </div>
                        <details className="upload-row-menu">
                          <summary className="compact-toggle upload-row-menu__toggle">
                            Actions
                            <ChevronDown className="compact-toggle__icon" size={14} />
                          </summary>
                          <div className="upload-row-menu__panel">
                            <Link className="upload-row-menu__action" to={previewHref}>
                              <ExternalLink size={14} />
                              Open
                            </Link>
                            <button
                              type="button"
                              className="upload-row-menu__action"
                              disabled={submitting}
                              onClick={async () => {
                                setMessage('');
                                setError('');
                                setSubmitting(true);
                                try {
                                  const result = await analyzeKbDocument(cat.category, file.filename);
                                  const id = Number(result?.id || 0);
                                  if (id > 0) {
                                    setMessage('Document analyzed. Opening details…');
                                    navigate(`/app/ai/documents/${id}`);
                                  } else {
                                    setMessage('Document analyzed.');
                                  }
                                } catch (e) {
                                  setError(e?.message || 'Analyze failed');
                                } finally {
                                  setSubmitting(false);
                                }
                              }}
                            >
                              {submitting ? 'Analyzing…' : 'Analyze'}
                            </button>
                            <button
                              type="button"
                              className="upload-row-menu__action"
                              onClick={() => {
                                const url = absoluteUrl(file.url);
                                const subject = encodeURIComponent(`KB: ${formatDataFileName(file.originalName || file.filename)}`);
                                const body = encodeURIComponent(`Quick reference link:\n${url}`);
                                window.location.href = `mailto:?subject=${subject}&body=${body}`;
                              }}
                            >
                              <Mail size={14} />
                              Email
                            </button>
                            <a className="upload-row-menu__action" href={file.url} download={file.filename}>
                              <Download size={14} />
                              Download
                            </a>
                            <a className="upload-row-menu__action" href={file.url} target="_blank" rel="noreferrer">
                              <Printer size={14} />
                              Print
                            </a>
                          </div>
                        </details>
                      </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
