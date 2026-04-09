import { useState } from 'react';
import { Bot, MessagesSquare, ShieldCheck } from 'lucide-react';
import { sendAiChat } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

export function AiPage() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!message.trim()) {
      setError('Enter a prompt to test the gateway.');
      return;
    }

    setError('');
    setIsSending(true);

    try {
      const result = await sendAiChat(message.trim());
      setResponse(result.message);
    } catch (requestError) {
      setResponse('');
      setError(requestError.message);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/ai"
        title="AI"
        description="The AI module is reserved for gateway-backed workflows and model tooling, not generic backend logic."
        actions={
          <span className="module__action-pill">
            <ShieldCheck size={15} />
            Isolated gateway boundary
          </span>
        }
      />

      <div className="card-grid">
        <Card tone="accent">
          <CardHeader
            eyebrow="Gateway prompt"
            title="Run a narrow prompt test"
            description="Use the AI gateway directly for small prompt tests. This keeps model traffic isolated from backend application logic."
          />

          <form className="upload-form" onSubmit={handleSubmit}>
            <label className="textarea-field">
              <span>Prompt</span>
              <textarea
                rows="5"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Summarize the risks in a CSV support queue."
              />
            </label>
            <Button disabled={isSending} type="submit">
              {isSending ? 'Sending...' : 'Send to AI Gateway'}
            </Button>
          </form>

          {error ? <p className="status-text status-text--error">{error}</p> : null}
        </Card>
        <Card>
          <CardHeader
            eyebrow="Boundary"
            title="Contained model tooling"
            description="Imported from the archive in spirit: keep AI-specific flows inside the gateway and present only narrow tools in the UI."
          />
          {response ? (
            <div className="response-block">
              <div className="response-block__header">
                <MessagesSquare size={16} />
                <span>Gateway response</span>
              </div>
              <p>{response}</p>
            </div>
          ) : (
            <EmptyState
              icon={<Bot size={20} />}
              title="No gateway response yet"
              description="Send a prompt to confirm the AI service path and response wiring."
            />
          )}
        </Card>
      </div>
    </section>
  );
}
