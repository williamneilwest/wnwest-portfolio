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
        {response?.kb_response?.steps?.length ? (
          <ol style={{ marginTop: 10, marginBottom: 0 }}>
            {response.kb_response.steps.map((step, index) => (
              <li key={`assistant-panel-step-${index}`}>{step}</li>
            ))}
          </ol>
        ) : null}
      </div>

      {hasNavigateAction ? (
        <div className="landing__actions" style={{ marginTop: 6 }}>
          <Button type="button" variant="secondary" onClick={() => navigate(response.action.path)}>
            Go to {response.action.path}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
