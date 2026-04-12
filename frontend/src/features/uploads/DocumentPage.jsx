import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Brain, Download, ExternalLink, FileText, RefreshCcw, Trash2 } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useBackNavigation } from '../../app/hooks/useBackNavigation';
import { deleteFileById, updateFileById } from '../../app/services/api';
import { analyzeDocumentAI } from '../../app/services/aiClient';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { parseFileId } from '../../app/utils/fileIds';
import { canPreviewInline, isImageFile, isPdfFile, isTextLikeFile } from '../../app/utils/documentFiles';
import { TokenUsage } from '../../components/TokenUsage';

const CATEGORY_OPTIONS = ['Work Instructions', 'Networking', 'Printers', 'General'];

function absoluteUrl(relative) {
  try {
    return new URL(relative, window.location.origin).toString();
  } catch {
    return relative;
  }
}

function renderPreview(url, fileName, mimeType) {
  if (isImageFile(fileName, mimeType)) {
    return <img alt={formatDataFileName(fileName) || 'Document preview'} className="document-view__image" src={url} />;
  }

  if (isPdfFile(fileName, mimeType) || isTextLikeFile(fileName, mimeType)) {
    return <iframe className="document-view__frame" src={url} title={formatDataFileName(fileName) || 'Document preview'} />;
  }

  return null;
}

function parseCategory(fileUrl, fallbackTitle) {
  const pathOnly = String(fileUrl || '').replace(/^https?:\/\/[^/]+/i, '').split('?', 1)[0];
  const match = pathOnly.match(/^\/(?:api\/)?kb\/([^/]+)\/[^/]+$/i);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return fallbackTitle || 'General';
}

function extractAnalysis(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const raw = String(data?.raw || data?.full_analysis || data?.quick_summary || '').trim();
  const tokenUsage = data?.token_usage && typeof data.token_usage === 'object' ? data.token_usage : null;
  const found = data?.found === false ? false : Boolean(raw);
  return { raw, tokenUsage, found };
}

export function DocumentPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const initialFileUrl = searchParams.get('url') || '';
  const initialFileName = searchParams.get('fileName') || '';
  const mimeType = searchParams.get('mimeType') || '';
  const title = searchParams.get('title') || 'Document';
  const backTo = searchParams.get('backTo') || '/app/uploads';
  const fallbackRoute = backTo || '/app/uploads';
  const goBack = useBackNavigation(fallbackRoute);
  const backLabel = location.state?.label
    || (fallbackRoute === '/app/kb' ? 'Knowledge Base' : 'Uploads');

  const [currentFileUrl, setCurrentFileUrl] = useState(initialFileUrl);
  const [currentFileName, setCurrentFileName] = useState(initialFileName);
  const [analysisText, setAnalysisText] = useState('');
  const [tokenUsage, setTokenUsage] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [hasExistingAnalysis, setHasExistingAnalysis] = useState(false);
  const [activeTab, setActiveTab] = useState('ai');
  const [editableName, setEditableName] = useState(initialFileName);
  const [editableCategory, setEditableCategory] = useState(parseCategory(initialFileUrl, title));
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsMessage, setDetailsMessage] = useState('');

  const previewUrl = absoluteUrl(currentFileUrl);
  const inlinePreview = canPreviewInline(currentFileName, mimeType);
  const displayName = formatDataFileName(currentFileName) || 'Document preview';
  const fileId = useMemo(() => parseFileId(currentFileUrl), [currentFileUrl]);

  async function applyFileUpdate(nextPayload) {
    if (!fileId) {
      throw new Error('File identifier is missing.');
    }
    const response = await updateFileById(fileId, nextPayload);
    const data = response?.data && typeof response.data === 'object' ? response.data : {};
    const nextUrl = String(data.url || currentFileUrl);
    const nextName = String(data.filename || currentFileName);
    setCurrentFileUrl(nextUrl);
    setCurrentFileName(nextName);
    setEditableName(nextName);
    if (Array.isArray(data.tags)) {
      setTags(data.tags);
    }
    if (typeof data.category === 'string' && data.category.trim()) {
      setEditableCategory(data.category);
    }
  }

  async function runAnalysis(rerun = true) {
    setAnalysisError('');
    setAnalysisNotice('');
    setAnalysisText('');
    setTokenUsage(null);
    setAnalyzing(true);
    try {
      let documentText = '';
      if (isTextLikeFile(currentFileName, mimeType)) {
        const response = await fetch(previewUrl);
        if (response.ok) {
          documentText = await response.text();
        }
      }

      const payload = await analyzeDocumentAI({
        documentText,
        documentName: currentFileName || title || 'Untitled Document',
        documentUrl: currentFileUrl,
        rerun,
      });
      const result = extractAnalysis(payload);
      setAnalysisText(result.raw);
      setTokenUsage(result.tokenUsage);
      setHasExistingAnalysis(Boolean(result.found));

      if (!result.raw) {
        setAnalysisError('AI analysis completed but no content was returned.');
      }
    } catch (requestError) {
      setAnalysisError(requestError?.message || 'AI analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadExistingAnalysis({ showMissingNotice = false } = {}) {
    setAnalysisError('');
    setAnalysisNotice('');
    setLoadingExisting(true);

    try {
      const payload = await analyzeDocumentAI({
        documentText: '',
        documentName: currentFileName || title || 'Untitled Document',
        documentUrl: currentFileUrl,
        rerun: false,
        lookupOnly: true,
      });
      const result = extractAnalysis(payload);
      setHasExistingAnalysis(Boolean(result.found));

      if (!result.found) {
        if (showMissingNotice) {
          setAnalysisNotice('No existing analysis found for this document yet.');
        }
        return;
      }

      setAnalysisText(result.raw);
      setTokenUsage(result.tokenUsage);
      setActiveTab('ai');
      setAnalysisNotice('Loaded existing analysis.');
    } catch (requestError) {
      setHasExistingAnalysis(false);
      if (showMissingNotice) {
        setAnalysisError(requestError?.message || 'Existing analysis could not be loaded.');
      }
    } finally {
      setLoadingExisting(false);
    }
  }

  useEffect(() => {
    if (!currentFileUrl) {
      return;
    }
    void loadExistingAnalysis();
  }, [currentFileName, currentFileUrl, title]);

  async function saveRename() {
    setSavingDetails(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      await applyFileUpdate({ name: editableName });
      setDetailsMessage('File name updated.');
    } catch (error) {
      setDetailsError(error?.message || 'Rename failed.');
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveCategory() {
    setSavingDetails(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      await applyFileUpdate({ category: editableCategory });
      setDetailsMessage('Category updated.');
    } catch (error) {
      setDetailsError(error?.message || 'Move failed.');
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveTags(nextTags) {
    setSavingDetails(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      await applyFileUpdate({ tags: nextTags });
      setDetailsMessage('Tags updated.');
    } catch (error) {
      setDetailsError(error?.message || 'Tag update failed.');
    } finally {
      setSavingDetails(false);
    }
  }

  async function removeTag(tag) {
    const nextTags = tags.filter((item) => item !== tag);
    setTags(nextTags);
    await saveTags(nextTags);
  }

  async function addTag() {
    const normalized = String(tagDraft || '').trim().toLowerCase();
    if (!normalized || tags.includes(normalized)) {
      setTagDraft('');
      return;
    }
    const nextTags = [...tags, normalized];
    setTags(nextTags);
    setTagDraft('');
    await saveTags(nextTags);
  }

  async function handleDelete() {
    if (!fileId) {
      setDetailsError('File identifier is missing.');
      return;
    }
    setSavingDetails(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      await deleteFileById(fileId);
      goBack();
    } catch (error) {
      setDetailsError(error?.message || 'Delete failed.');
    } finally {
      setSavingDetails(false);
    }
  }

  if (!currentFileUrl) {
    return (
      <section className="module">
        <Card className="analysis-grid__wide">
          <EmptyState
            icon={<FileText size={20} />}
            title="No document selected"
            description="Open a file from Uploads or the Knowledge Base to preview it here."
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="module">
      <Card className="analysis-grid__wide">
        <CardHeader
          eyebrow="Document Workspace"
          title="Metadata + AI"
          description="Manage document metadata and review AI output."
          action={<TokenUsage usage={tokenUsage} />}
        />
        <div className="table-actions document-analysis-tabs">
          <button
            type="button"
            className={`compact-toggle${activeTab === 'ai' ? ' compact-toggle--active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI
          </button>
          <button
            type="button"
            className={`compact-toggle${activeTab === 'details' ? ' compact-toggle--active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Details
          </button>
          <button
            type="button"
            className={`compact-toggle${activeTab === 'actions' ? ' compact-toggle--active' : ''}`}
            onClick={() => setActiveTab('actions')}
          >
            Actions
          </button>
        </div>

        {analysisError ? <p className="status-text status-text--error">{analysisError}</p> : null}
        {analysisNotice ? <p className="status-text">{analysisNotice}</p> : null}
        {detailsError ? <p className="status-text status-text--error">{detailsError}</p> : null}
        {detailsMessage ? <p className="status-text status-text--success">{detailsMessage}</p> : null}

        {activeTab === 'ai' ? (
          <>
            {!analysisText && !analyzing ? (
              <EmptyState
                icon={<Brain size={20} />}
                title="Run analysis to populate this panel"
                description="The full AI response is rendered as raw text."
              />
            ) : null}
            {analyzing ? <p className="status-text">Analyzing document with AI...</p> : null}
            {analysisText ? <pre className="ai-raw-response">{analysisText}</pre> : null}
          </>
        ) : null}

        {activeTab === 'details' ? (
          <div className="document-details-grid">
            <label className="settings-field">
              <span>File name</span>
              <input value={editableName} onChange={(event) => setEditableName(event.target.value)} />
              <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void saveRename()}>
                Save Name
              </button>
            </label>

            <label className="settings-field">
              <span>Category</span>
              <select value={editableCategory} onChange={(event) => setEditableCategory(event.target.value)}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void saveCategory()}>
                Save Category
              </button>
            </label>

            <div className="settings-field">
              <span>Tags</span>
              <div className="document-tag-list">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="badge document-tag-chip"
                    onClick={() => {
                      void removeTag(tag);
                    }}
                    disabled={savingDetails}
                  >
                    {tag} ×
                  </button>
                ))}
              </div>
              <div className="table-actions">
                <input
                  className="table-filter"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="Add tag"
                />
                <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void addTag()}>
                  Add Tag
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'actions' ? (
          <div className="table-actions">
            <button
              type="button"
              className="compact-toggle"
              disabled={loadingExisting}
              onClick={() => void loadExistingAnalysis({ showMissingNotice: true })}
            >
              {loadingExisting ? 'Loading…' : 'View Existing'}
            </button>
            <button type="button" className="compact-toggle" disabled={analyzing} onClick={() => void runAnalysis(true)}>
              <RefreshCcw size={14} />
              Re-analyze
            </button>
            <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void saveRename()}>
              Rename
            </button>
            <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void saveCategory()}>
              Move
            </button>
            <button type="button" className="compact-toggle" disabled={savingDetails} onClick={() => void handleDelete()}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        ) : null}
      </Card>

      <Card className="analysis-grid__wide">
        <CardHeader
          eyebrow={title}
          title={displayName}
          description={mimeType || 'Stored file'}
          action={
            <div className="table-actions">
              <button
                type="button"
                className="compact-toggle"
                disabled={analyzing}
                onClick={() => {
                  void runAnalysis(true);
                }}
              >
                <Brain size={15} />
                {analyzing ? 'Analyzing...' : 'Analyze with AI'}
              </button>
              <button
                type="button"
                className={`compact-toggle${hasExistingAnalysis ? ' compact-toggle--active' : ''}`}
                disabled={loadingExisting}
                onClick={() => void loadExistingAnalysis({ showMissingNotice: true })}
              >
                {loadingExisting ? 'Loading…' : 'View Existing'}
              </button>
              <a className="compact-toggle" href={previewUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={15} />
                Open Raw
              </a>
              <a className="compact-toggle" download={currentFileName} href={previewUrl}>
                <Download size={15} />
                Download
              </a>
              <button type="button" className="compact-toggle" onClick={goBack}>
                <ArrowLeft size={15} />
                {`Back to ${backLabel}`}
              </button>
            </div>
          }
        />

        {inlinePreview ? (
          <div className="document-view">
            {renderPreview(previewUrl, currentFileName, mimeType)}
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={20} />}
            title="Preview not available in-browser"
            description="This document type is supported for download and raw open, but the browser may not render it inline."
          />
        )}
      </Card>
    </section>
  );
}
