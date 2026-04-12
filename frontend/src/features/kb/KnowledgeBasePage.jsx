import { useEffect, useMemo, useState } from 'react';
import { Folder, FileText, Download, Mail, ExternalLink, Printer, ChevronDown, Flame, Pencil } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { analyzeKbDocument, getKnowledgeBase, getMostAccessedKnowledgeBase, updateFileById } from '../../app/services/api';
import { parseFileId } from '../../app/utils/fileIds';
import { Card, CardHeader } from '../../app/ui/Card';
import { buildDocumentViewHref } from '../../app/utils/documentFiles';
import { EmptyState } from '../../app/ui/EmptyState';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { FileDetailsEditor } from '../../components/files/FileDetailsEditor';

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

function scoreMostAccessed(file) {
  return {
    accessCount: Number(file?.accessCount || 0),
    lastOpenedAt: String(file?.lastOpenedAt || ''),
    modifiedAt: String(file?.modifiedAt || ''),
  };
}

export function KnowledgeBasePage() {
  const [data, setData] = useState({ categories: [] });
  const [mostAccessedData, setMostAccessedData] = useState({ documents: [] });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('most_accessed');
  const [activeCategory, setActiveCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  async function loadKnowledgeBase() {
    const [kbPayload, mostAccessedPayload] = await Promise.all([getKnowledgeBase(), getMostAccessedKnowledgeBase(40)]);
    setData(kbPayload && typeof kbPayload === 'object' ? kbPayload : { categories: [] });
    setMostAccessedData(
      mostAccessedPayload && typeof mostAccessedPayload === 'object'
        ? mostAccessedPayload
        : { documents: [] }
    );
  }

  useEffect(() => {
    let mounted = true;

    loadKnowledgeBase()
      .catch((e) => {
        if (mounted) setError(e.message || 'Knowledge Base could not be loaded.');
      });

    return () => { mounted = false; };
  }, []);

  const categories = useMemo(() => {
    const cats = Array.isArray(data.categories) ? data.categories : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return cats;
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

  const fallbackMostAccessed = useMemo(() => {
    const flattened = categories.flatMap((category) =>
      (Array.isArray(category.files) ? category.files : []).map((file) => ({
        ...file,
        category: category.category,
      }))
    );

    return [...flattened].sort((left, right) => {
      const a = scoreMostAccessed(left);
      const b = scoreMostAccessed(right);
      if (a.accessCount !== b.accessCount) return b.accessCount - a.accessCount;
      if (a.lastOpenedAt !== b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      return b.modifiedAt.localeCompare(a.modifiedAt);
    });
  }, [categories]);

  const mostAccessedFiles = useMemo(() => {
    const docs = Array.isArray(mostAccessedData.documents) ? mostAccessedData.documents : [];
    const fromEndpoint = [...docs].sort((left, right) => {
      const a = scoreMostAccessed(left);
      const b = scoreMostAccessed(right);
      if (a.accessCount !== b.accessCount) return b.accessCount - a.accessCount;
      if (a.lastOpenedAt !== b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      return b.modifiedAt.localeCompare(a.modifiedAt);
    });

    if (fromEndpoint.length) {
      return fromEndpoint;
    }

    return fallbackMostAccessed;
  }, [fallbackMostAccessed, mostAccessedData.documents]);

  const filteredMostAccessedFiles = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      return mostAccessedFiles;
    }

    return mostAccessedFiles.filter((file) => {
      const nameHit = String(file.filename || '').toLowerCase().includes(q)
        || String(file.originalName || '').toLowerCase().includes(q);
      const tagHit = (Array.isArray(file.tags) ? file.tags : []).some((tag) => String(tag || '').toLowerCase().includes(q));
      const categoryHit = String(file.category || '').toLowerCase().includes(q);
      return nameHit || tagHit || categoryHit;
    });
  }, [mostAccessedFiles, query]);

  useEffect(() => {
    if (filterMode !== 'category') {
      return;
    }

    if (!categories.length) {
      if (activeCategory) {
        setActiveCategory('');
      }
      return;
    }

    if (!categories.some((category) => category.category === activeCategory)) {
      setActiveCategory(categories[0].category);
    }
  }, [activeCategory, categories, filterMode]);

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
  const renderedFiles = filterMode === 'most_accessed' ? filteredMostAccessedFiles : selectedFiles;
  const totalFileCount = categories.reduce((count, category) => count + (Array.isArray(category.files) ? category.files.length : 0), 0);
  const categoryOptions = useMemo(() => {
    const options = categories.map((category) => String(category.category || '').trim()).filter(Boolean);
    if (!options.includes('uncategorized')) {
      options.unshift('uncategorized');
    }
    return options;
  }, [categories]);

  async function handleSaveFileDetails(file, payload) {
    const fileId = parseFileId(file?.url || '');
    if (!fileId) {
      throw new Error('File identifier is missing.');
    }

    setError('');
    setMessage('');
    const nextPayload = {
      name: payload?.name,
      category: payload?.category,
      tags: Array.isArray(payload?.tags) ? payload.tags : [],
    };
    await updateFileById(fileId, nextPayload);
    await loadKnowledgeBase();
    setEditingKey('');
    setMessage('File details updated.');
  }

  return (
    <section className="module">
      <Card className="analysis-grid__wide kb-shell-card">
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
                    className={`kb-sidebar__item${filterMode === 'category' && activeCategory === category.category ? ' kb-sidebar__item--active' : ''}`}
                    onClick={() => {
                      setFilterMode('category');
                      setActiveCategory(category.category);
                    }}
                  >
                    <span>{formatCategoryLabel(category.category)}</span>
                    <small>{(category.files?.length || 0)} files</small>
                  </button>
                ))}
              </div>
            </aside>

            <div className="kb-main">
              <div className="kb-main__toolbar">
                <div className="kb-filter-tabs" role="tablist" aria-label="Knowledge base view mode">
                  <button
                    type="button"
                    className={`compact-toggle${filterMode === 'most_accessed' ? ' compact-toggle--active' : ''}`}
                    onClick={() => setFilterMode('most_accessed')}
                  >
                    Most Accessed
                  </button>
                  <button
                    type="button"
                    className={`compact-toggle${filterMode === 'category' ? ' compact-toggle--active' : ''}`}
                    onClick={() => {
                      setFilterMode('category');
                      if (!activeCategory && categories[0]?.category) {
                        setActiveCategory(categories[0].category);
                      }
                    }}
                  >
                    Categories
                  </button>
                </div>
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
                <strong>
                  {filterMode === 'most_accessed'
                    ? 'Most Accessed'
                    : formatCategoryLabel(selectedCategory?.category || 'Knowledge Base')}
                </strong>
                <small>{renderedFiles.length} files</small>
              </div>

              {renderedFiles.length ? (
                <div className="kb-file-list">
                  {renderedFiles.map((file) => {
                    const fileCategory = String(file.category || selectedCategory?.category || '').trim();
                    const previewHref = buildDocumentViewHref({
                      url: file.url,
                      fileName: file.filename,
                      mimeType: file.mimeType,
                      title: 'Knowledge Base',
                      backTo: '/app/kb',
                    });

                    const label = formatDataFileName(file.originalName || file.filename);
                    const fileTags = visibleTags(file.tags, fileCategory);
                    const visibleFileTags = fileTags.slice(0, 5);
                    const hiddenTagCount = Math.max(0, fileTags.length - visibleFileTags.length);
                    const subtitle = `${formatDateShort(file.modifiedAt)} • ${formatMimeLabel(file.filename, file.mimeType)} • ${formatCategoryLabel(fileCategory)}`;
                    const hasAnalysis = Boolean(Number(file.analysis?.documentId || file.analysis?.analysisId || 0));
                    const accessCount = Number(file.accessCount || 0);

                    const fileKey = `${fileCategory}-${file.filename}`;
                    return (
                      <article className="kb-file-row" key={`${fileCategory}-${file.filename}`}>
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
                          <div className="kb-chip-row">
                            {accessCount > 0 ? (
                              <span className="kb-chip kb-chip--popular">
                                <Flame size={12} />
                                {`Popular • ${accessCount}`}
                              </span>
                            ) : null}
                            {hasAnalysis ? (
                              <span className="kb-chip kb-chip--analysis">Analyzed</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="kb-file-row__right">
                          <details className="upload-row-menu kb-actions-menu">
                            <summary className="compact-toggle compact-toggle--icon upload-row-menu__toggle kb-action kb-action--tertiary" aria-label="More actions">
                              <ChevronDown className="compact-toggle__icon" size={14} />
                            </summary>
                            <div className="upload-row-menu__panel">
                              <div className="upload-row-menu__group">
                                <Link
                                  className="upload-row-menu__action"
                                  to={previewHref}
                                  state={{
                                    from: `${location.pathname}${location.search || ''}`,
                                    label: 'Knowledge Base',
                                  }}
                                >
                                  <ExternalLink size={16} />
                                  Open
                                </Link>
                                <button
                                  type="button"
                                  className="upload-row-menu__action"
                                  disabled={submitting}
                                  onClick={() => void handleAnalyze(fileCategory, file.filename, file.analysis)}
                                >
                                  <FileText size={16} />
                                  {submitting ? 'Analyzing…' : 'Analyze'}
                                </button>
                              </div>

                              <div className="upload-row-menu__separator" aria-hidden="true" />

                              <div className="upload-row-menu__group">
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
                                  <Mail size={16} />
                                  Email
                                </button>
                                <a className="upload-row-menu__action" href={file.url} download={file.filename}>
                                  <Download size={16} />
                                  Download
                                </a>
                                <a className="upload-row-menu__action" href={file.url} target="_blank" rel="noreferrer">
                                  <Printer size={16} />
                                  Print
                                </a>
                              </div>

                              <div className="upload-row-menu__separator" aria-hidden="true" />

                              <div className="upload-row-menu__group">
                                <button
                                  type="button"
                                  className="upload-row-menu__action upload-row-menu__action--edit"
                                  onClick={() => setEditingKey((current) => (current === fileKey ? '' : fileKey))}
                                >
                                  <Pencil size={16} />
                                  Edit details
                                </button>
                              </div>
                              {editingKey === fileKey ? (
                                <FileDetailsEditor
                                  name={file.originalName || file.filename}
                                  category={fileCategory}
                                  tags={Array.isArray(file.tags) ? file.tags : []}
                                  categoryOptions={categoryOptions}
                                  disabled={submitting}
                                  onSave={(nextPayload) => handleSaveFileDetails(file, nextPayload)}
                                />
                              ) : null}
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
                  title={filterMode === 'most_accessed' ? 'No recently accessed documents yet' : 'No files in this category'}
                  description={filterMode === 'most_accessed' ? 'Open a document to populate Most Accessed.' : 'Try another category or adjust your search.'}
                />
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

export default KnowledgeBasePage;
