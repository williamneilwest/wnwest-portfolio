import { useEffect, useMemo, useState } from 'react';
import { Folder, FileText, Download, Mail, ExternalLink, Printer, ChevronDown } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

function formatDateShort(value) {
  if (!value) return 'Unknown';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMimeLabel(fileName, mimeType) {
  const fromMime = String(mimeType || '').trim().toLowerCase();
  if (fromMime.includes('pdf')) return 'PDF';
  if (fromMime.includes('json')) return 'JSON';
  if (fromMime.includes('csv')) return 'CSV';
  if (fromMime.includes('wordprocessingml') || fromMime.includes('msword')) return 'DOC';
  if (fromMime.includes('spreadsheetml') || fromMime.includes('excel')) return 'XLS';
  if (fromMime.includes('presentationml') || fromMime.includes('powerpoint')) return 'PPT';
  if (fromMime.startsWith('image/')) return 'Image';
  if (fromMime.startsWith('text/')) return 'Text';

  const ext = String(fileName || '').split('.').pop()?.trim().toUpperCase() || '';
  return ext || 'File';
}

function formatCategoryLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function visibleTags(tags, category) {
  const cat = String(category || '').trim().toLowerCase();
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      return normalized !== 'uncategorized' && normalized !== cat;
    });
}

export function KnowledgeBasePage() {
  const [data, setData] = useState({ categories: [] });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

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

  useEffect(() => {
    if (!categories.length) {
      if (activeCategory) {
        setActiveCategory('');
      }
      return;
    }

    if (!categories.some((category) => category.category === activeCategory)) {
      setActiveCategory(categories[0].category);
    }
  }, [activeCategory, categories]);

  function absoluteUrl(relative) {
    try {
      return new URL(relative, window.location.origin).toString();
    } catch {
      return relative;
    }
  }

  async function handleAnalyze(category, fileName, existingAnalysis = null) {
    const existingDocumentId = Number(existingAnalysis?.documentId || existingAnalysis?.analysisId || 0);
    if (existingDocumentId > 0) {
      setMessage('Loaded previous analysis from metadata.');
      navigate(`/app/ai/documents/${existingDocumentId}`, {
        state: {
          from: `${location.pathname}${location.search || ''}`,
          label: 'Knowledge Base',
        },
      });
      return;
    }

    setMessage('');
    setError('');
    setSubmitting(true);
    try {
      const result = await analyzeKbDocument(category, fileName);
      const id = Number(result?.id || 0);
      if (id > 0) {
        setMessage('Document analyzed. Opening details…');
        navigate(`/app/ai/documents/${id}`, {
          state: {
            from: `${location.pathname}${location.search || ''}`,
            label: 'Knowledge Base',
          },
        });
      } else {
        setMessage('Document analyzed.');
      }
    } catch (requestError) {
      setError(requestError?.message || 'Analyze failed');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCategory = categories.find((category) => category.category === activeCategory) || null;
  const selectedFiles = Array.isArray(selectedCategory?.files) ? selectedCategory.files : [];
  const totalFileCount = categories.reduce((count, category) => count + (Array.isArray(category.files) ? category.files.length : 0), 0);

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

        {categories.length === 0 ? (
          <EmptyState
            icon={<Folder size={20} />}
            title="No Knowledge Base docs yet"
            description="Send attachments to kb@mail.westos.dev to populate this list."
          />
        ) : (
          <div className="kb-browser">
            <aside className="kb-sidebar" aria-label="Knowledge Base categories">
              <div className="kb-sidebar__header">
                <strong>Categories</strong>
                <small>{totalFileCount} files</small>
              </div>
              <div className="kb-sidebar__list">
                {categories.map((category) => (
                  <button
                    key={category.category}
                    type="button"
                    className={`kb-sidebar__item${activeCategory === category.category ? ' kb-sidebar__item--active' : ''}`}
                    onClick={() => setActiveCategory(category.category)}
                  >
                    <span>{formatCategoryLabel(category.category)}</span>
                    <small>{(category.files?.length || 0)} files</small>
                  </button>
                ))}
              </div>
            </aside>

            <div className="kb-main">
              <div className="kb-main__toolbar">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search docs, tags, systems..."
                  className="input kb-main__search"
                  aria-label="Search knowledge base"
                />
              </div>

              <div className="kb-main__header">
                <strong>{formatCategoryLabel(selectedCategory?.category || 'Knowledge Base')}</strong>
                <small>{selectedFiles.length} files</small>
              </div>

              {selectedFiles.length ? (
                <div className="kb-file-list">
                  {selectedFiles.map((file) => {
                    const previewHref = buildDocumentViewHref({
                      url: file.url,
                      fileName: file.filename,
                      mimeType: file.mimeType,
                      title: 'Knowledge Base',
                      backTo: '/app/kb',
                    });

                    const label = formatDataFileName(file.originalName || file.filename);
                    const fileTags = visibleTags(file.tags, selectedCategory?.category);
                    const visibleFileTags = fileTags.slice(0, 5);
                    const hiddenTagCount = Math.max(0, fileTags.length - visibleFileTags.length);
                    const subtitle = `${formatDateShort(file.modifiedAt)} • ${formatMimeLabel(file.filename, file.mimeType)} • ${formatCategoryLabel(selectedCategory?.category || '')}`;
                    const hasAnalysis = Boolean(Number(file.analysis?.documentId || file.analysis?.analysisId || 0));

                    return (
                      <article className="kb-file-row" key={file.filename}>
                        <div className="kb-file-row__left">
                          <span className="kb-file-row__icon">
                            <FileText size={16} />
                          </span>
                          <span className="kb-file-row__file">
                            <strong title={label}>{label}</strong>
                            <small title={formatWhen(file.modifiedAt)}>{subtitle}</small>
                          </span>
                        </div>

                        <div className="kb-file-row__center">
                          {visibleFileTags.length ? (
                            <div className="kb-chip-row">
                              {visibleFileTags.map((tag) => (
                                <span className="kb-chip" key={tag}>{tag}</span>
                              ))}
                              {hiddenTagCount > 0 ? <span className="kb-chip kb-chip--more">+{hiddenTagCount} more</span> : null}
                            </div>
                          ) : <small className="kb-file-row__hint">No tags</small>}
                          {hasAnalysis ? (
                            <div className="kb-chip-row">
                              <span className="kb-chip kb-chip--analysis">Analyzed</span>
                            </div>
                          ) : null}
                        </div>

                        <div className="kb-file-row__right">
                          <Link
                            className="compact-toggle kb-action kb-action--primary"
                            to={previewHref}
                            state={{
                              from: `${location.pathname}${location.search || ''}`,
                              label: 'Knowledge Base',
                            }}
                          >
                            <ExternalLink size={14} />
                            Open
                          </Link>
                          <button
                            type="button"
                            className="compact-toggle kb-action kb-action--secondary"
                            disabled={submitting}
                            onClick={() => void handleAnalyze(selectedCategory.category, file.filename, file.analysis)}
                          >
                            {submitting ? 'Analyzing…' : 'Analyze'}
                          </button>
                          <details className="upload-row-menu kb-actions-menu">
                            <summary className="compact-toggle compact-toggle--icon upload-row-menu__toggle kb-action kb-action--tertiary" aria-label="More actions">
                              <ChevronDown className="compact-toggle__icon" size={14} />
                            </summary>
                            <div className="upload-row-menu__panel">
                              <button
                                type="button"
                                className="upload-row-menu__action"
                                onClick={() => {
                                  const url = absoluteUrl(file.url);
                                  const subject = encodeURIComponent(`KB: ${label}`);
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
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<Folder size={20} />}
                  title="No files in this category"
                  description="Try another category or adjust your search."
                />
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
