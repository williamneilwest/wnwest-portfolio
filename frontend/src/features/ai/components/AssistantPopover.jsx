import { BrainCircuit, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { STORAGE_KEYS } from '../../../app/constants/storageKeys';
import { askAssistant, getLogsSummary } from '../../../app/services/api';
import { storage } from '../../../app/utils/storage';
import { Button } from '../../../app/ui/Button';

const QUICK_ACTIONS = [
  'Explain this page',
  'Summarize logs',
  "What's broken?",
  'Suggest next steps',
];

const LOGS_REQUIRED_PATTERNS = [
  /summarize logs?/i,
  /what(?:'|’)s broken/i,
  /\blogs?\b/i,
  /\berrors?\b/i,
  /\bissues?\b/i,
];

function isLogsIntent(query) {
  const value = String(query || '');
  return LOGS_REQUIRED_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizeAssistantMessage(message, fallback = '') {
  const trimmed = String(message || '').trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed) {
    return fallback || 'No response returned.';
  }

  if (
    normalized.includes('log missing')
    || normalized.includes('log is missing')
    || normalized.includes('no log provided')
    || normalized.includes('no data provided')
    || normalized.includes('error log details are missing')
    || normalized.includes('provide the specific error message')
  ) {
    return 'No logs available to analyze';
  }

  return trimmed;
}

function extractTicketSample(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .slice(0, 5)
    .map((row) => row?.Ticket || row?.ticket || row?.id || row?.number)
    .filter(Boolean);
}

function buildKbContext(pathname) {
  if (!pathname.startsWith('/app/kb')) {
    return null;
  }

  return {
    area: 'knowledge-base',
    route: pathname,
  };
}

export function AssistantPopover() {
  const location = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState({
    message: '',
    action: { type: 'none', path: '' },
    routing: null,
    sourceAgent: '',
    responseType: '',
    originalQuery: '',
    kbResponse: null,
    kbMatches: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => String(query || '').trim().length > 0 && !loading, [loading, query]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  async function buildRequestContext(trimmedQuery) {
    const pathname = window.location.pathname || location.pathname;
    const context = {
      route: pathname,
    };

    if (pathname.startsWith('/app/work')) {
      const ticketDataset = storage.get(STORAGE_KEYS.FULL_DATASET, { session: true });
      const rows = Array.isArray(ticketDataset?.rows) ? ticketDataset.rows : [];
      context.tickets = {
        count: rows.length,
        sample: extractTicketSample(rows),
      };
    }

    const kbContext = buildKbContext(pathname);
    if (kbContext) {
      context.documents = kbContext;
    }

    if (isLogsIntent(trimmedQuery) || pathname.startsWith('/app/console')) {
      try {
        const summary = await getLogsSummary({ source: 'docker' });
        const errors = Array.isArray(summary?.errors) ? summary.errors : [];
        const warnings = Array.isArray(summary?.warnings) ? summary.warnings : [];
        const logItems = [...errors, ...warnings];

        if (!logItems.length) {
          return {
            context,
            noLogs: true,
          };
        }

        context.logs = logItems.slice(0, 8).map((item) => ({
          severity: item?.severity || 'unknown',
          message: String(item?.message || '').slice(0, 300),
          timestamp: item?.timestamp || '',
        }));
      } catch {
        return {
          context,
          noLogs: true,
        };
      }
    }

    return { context, noLogs: false };
  }

  async function submitAssistant(prompt) {
    const trimmedQuery = String(prompt || '').trim();
    if (!trimmedQuery) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { context, noLogs } = await buildRequestContext(trimmedQuery);
      if (noLogs) {
        setResponse({
          message: 'No logs available to analyze',
          action: { type: 'none', path: '' },
          kbMatches: [],
        });
        return;
      }

      const payload = await askAssistant({
        query: trimmedQuery,
        currentRoute: window.location.pathname || location.pathname,
        context,
      });

      setResponse({
        message: sanitizeAssistantMessage(payload?.message, 'I can help with app navigation and next steps.'),
        action: payload?.action && typeof payload.action === 'object' ? payload.action : { type: 'none', path: '' },
        routing: payload?.routing && typeof payload.routing === 'object' ? payload.routing : null,
        sourceAgent: String(payload?.source_agent || '').trim(),
        responseType: String(payload?.response_type || '').trim(),
        originalQuery: String(payload?.original_user_query || trimmedQuery).trim(),
        kbResponse: payload?.kb_response && typeof payload.kb_response === 'object' ? payload.kb_response : null,
        kbMatches: Array.isArray(payload?.kb_matches) ? payload.kb_matches : [],
      });
    } catch (requestError) {
      setError(requestError.message || 'Assistant request failed.');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    void submitAssistant(query);
  }

  function onQuickAction(prompt) {
    setQuery(prompt);
    void submitAssistant(prompt);
  }

  const kbAnswerType = String(response?.kbResponse?.answer_type || response?.responseType || '').trim().toLowerCase();
  const hasKbLink = kbAnswerType === 'kb_link' && String(response?.kbResponse?.document_id || '').trim();
  const kbPrimaryTitle = String(response?.kbResponse?.title || '').trim();
  const kbPrimaryDocId = String(response?.kbResponse?.document_id || '').trim();
  const kbMatches = Array.isArray(response?.kbMatches) ? response.kbMatches : [];
  const kbAlternates = kbMatches
    .map((item) => ({
      title: String(item?.title || '').trim(),
      documentId: String(item?.document_id || item?.doc_id || '').trim(),
    }))
    .filter((item) => item.title && item.documentId && item.documentId !== kbPrimaryDocId)
    .slice(0, 3);

  return (
    <div className="assistant-popover" ref={rootRef}>
      <button
        type="button"
        className="compact-toggle assistant-popover__trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Sparkles size={14} />
        Assistant
      </button>

      {isOpen ? (
        <section className="assistant-popover__panel" role="dialog" aria-label="Global AI assistant">
          <header className="assistant-popover__header">
            <span className="assistant-popover__title">
              <BrainCircuit size={16} />
              AI Assistant
            </span>
            <button type="button" className="assistant-popover__close" onClick={() => setIsOpen(false)} aria-label="Close assistant">
              <X size={16} />
            </button>
          </header>

          <div className="assistant-popover__body">
            <div className="assistant-popover__quick-actions">
              {QUICK_ACTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="compact-toggle"
                  onClick={() => onQuickAction(prompt)}
                  disabled={loading}
                >
                  {prompt}
                </button>
              ))}
            </div>

            {error ? <p className="status-text status-text--error">{error}</p> : null}

            <div className="assistant-popover__response">
              <p>{response.message || 'Ask for help navigating pages, understanding features, or next steps.'}</p>
              {hasKbLink ? (
                <div className="stack-list" style={{ marginTop: 10 }}>
                  <p className="status-text" style={{ margin: 0 }}>
                    <strong>{kbPrimaryTitle || 'Knowledge Base Article'}</strong>
                  </p>
                  <Button type="button" variant="secondary" onClick={() => navigate(`/app/kb?id=${encodeURIComponent(kbPrimaryDocId)}`)}>
                    Open Article
                  </Button>
                  {kbAlternates.length ? (
                    <div className="stack-list" style={{ marginTop: 6 }}>
                      {kbAlternates.map((item) => (
                        <div key={`assistant-kb-match-${item.documentId}`} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className="status-text">{item.title}</span>
                          <Button type="button" variant="secondary" onClick={() => navigate(`/app/kb?id=${encodeURIComponent(item.documentId)}`)}>
                            Open Article
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <form className="assistant-popover__form assistant-popover__form--sticky" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              className="ticket-queue__filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask for guidance..."
              disabled={loading}
            />
            <div className="assistant-popover__actions">
              <Button type="submit" disabled={!canSubmit}>
                {loading ? 'Thinking...' : 'Ask'}
              </Button>
              {response?.action?.type === 'navigate' && response?.action?.path && !hasKbLink ? (
                <Button type="button" variant="secondary" onClick={() => navigate(response.action.path)}>
                  Go to {response.action.path}
                </Button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
