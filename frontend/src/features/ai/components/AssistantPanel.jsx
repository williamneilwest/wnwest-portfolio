import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { askAssistant } from '../../../app/services/api';
import { Card, CardHeader } from '../../../app/ui/Card';
import { Button } from '../../../app/ui/Button';

const QUICK_PROMPTS = [
  'Where are my tickets?',
  'Explain this page',
  'How do I upload data?',
];

const EMPTY_RESPONSE = {
  message: '',
  action: { type: 'none', path: '' },
  kb_response: null,
  kb_matches: [],
};

export function AssistantPanel() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState(EMPTY_RESPONSE);
  const location = useLocation();
  const navigate = useNavigate();

  const canSubmit = useMemo(() => String(query || '').trim().length > 0 && !loading, [loading, query]);
  const hasNavigateAction = response?.action?.type === 'navigate' && Boolean(response?.action?.path);
  const kbAnswerType = String(response?.kb_response?.answer_type || '').trim().toLowerCase();
  const hasKbLink = kbAnswerType === 'kb_link' && String(response?.kb_response?.document_id || '').trim();
  const primaryDocId = String(response?.kb_response?.document_id || '').trim();
  const alternates = (Array.isArray(response?.kb_matches) ? response.kb_matches : [])
    .map((item) => ({
      title: String(item?.title || '').trim(),
      documentId: String(item?.document_id || item?.doc_id || '').trim(),
    }))
    .filter((item) => item.title && item.documentId && item.documentId !== primaryDocId)
    .slice(0, 3);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = await askAssistant({
        query: trimmedQuery,
        currentRoute: location.pathname,
      });

      setResponse({
        message: String(payload?.message || '').trim(),
        action: payload?.action && typeof payload.action === 'object' ? payload.action : { type: 'none', path: '' },
        kb_response: payload?.kb_response && typeof payload.kb_response === 'object' ? payload.kb_response : null,
        kb_matches: Array.isArray(payload?.kb_matches) ? payload.kb_matches : [],
      });
    } catch (requestError) {
      setError(requestError.message || 'Assistant request failed.');
      setResponse(EMPTY_RESPONSE);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="landing__card">
      <CardHeader
        eyebrow="Assistant"
        title="In-App System Helper"
        description="Ask for navigation, page explanations, and workflow guidance."
      />

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="compact-toggle"
              onClick={() => setQuery(prompt)}
              disabled={loading}
            >
              {prompt}
            </button>
          ))}
        </div>

        <input
          className="ticket-queue__filter"
          placeholder="Ask the assistant..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loading}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button type="submit" disabled={!canSubmit}>
            {loading ? 'Thinking...' : 'Ask Assistant'}
          </Button>
          {error ? <span className="status-text status-text--error">{error}</span> : null}
        </div>
      </form>

      <div
        className="ui-card"
        style={{
          marginTop: 8,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          maxHeight: 180,
          overflowY: 'auto',
        }}
      >
        <p style={{ margin: 0, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
          {response.message || 'Assistant responses will appear here.'}
        </p>
        {hasKbLink ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <strong>{String(response?.kb_response?.title || 'Knowledge Base Article')}</strong>
            <Button type="button" variant="secondary" onClick={() => navigate(`/app/kb?id=${encodeURIComponent(primaryDocId)}`)}>
              Open Article
            </Button>
            {alternates.length ? alternates.map((item) => (
              <div key={`assistant-panel-kb-${item.documentId}`} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="status-text">{item.title}</span>
                <Button type="button" variant="secondary" onClick={() => navigate(`/app/kb?id=${encodeURIComponent(item.documentId)}`)}>
                  Open Article
                </Button>
              </div>
            )) : null}
          </div>
        ) : null}
      </div>

      {hasNavigateAction && !hasKbLink ? (
        <div className="landing__actions" style={{ marginTop: 6 }}>
          <Button type="button" variant="secondary" onClick={() => navigate(response.action.path)}>
            Go to {response.action.path}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
