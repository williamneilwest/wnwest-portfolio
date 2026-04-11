import { Bot, Database, Shield, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, updateAiSettings } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

function PlaceholderSettingCard({ icon: Icon, title, description }) {
  return (
    <Card className="landing__card">
      <CardHeader eyebrow="Placeholder" title={title} description={description} />
      <div className="landing__actions">
        <span className="icon-badge">
          <Icon size={18} />
        </span>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getSettings()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        const nextSettings = result;
        setSettings(nextSettings);
        setSelectedModel(nextSettings.ai?.currentModel || '');
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(requestError.message || 'Settings could not be loaded.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleAiModelSave() {
    setError('');
    setIsSaving(true);

    try {
      const result = await updateAiSettings(selectedModel);
      setSettings(result);
      setSelectedModel(result.ai?.currentModel || '');
    } catch (requestError) {
      setError(requestError.message || 'AI model could not be updated.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return (
      <section className="module">
        <SectionHeader tag="/app/settings" title="Settings" description="Application configuration surfaces." />
        <EmptyState
          icon={<SlidersHorizontal size={20} />}
          title="Loading settings"
          description={error || 'Fetching current application settings.'}
        />
      </section>
    );
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/settings"
        title="Settings"
        description="Minimal application configuration. AI model switching is live; the remaining cards are placeholders for future settings."
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}

      <div className="card-grid">
        <Card className="landing__card">
          <CardHeader
            eyebrow="Live"
            title="AI Model"
            description={`Current provider: ${settings.ai?.provider || 'unknown'}. Switch the model used by app AI requests.`}
          />
          <div className="upload-form">
            <label className="column-filter__label" htmlFor="ai-model-select">
              Active model
            </label>
            <select
              className="ticket-queue__filter"
              id="ai-model-select"
              onChange={(event) => setSelectedModel(event.target.value)}
              value={selectedModel}
            >
              {(settings.ai?.availableModels || []).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <button className="ui-button ui-button--primary" disabled={isSaving || !selectedModel} onClick={handleAiModelSave} type="button">
              <Bot size={16} />
              {isSaving ? 'Saving...' : 'Save AI Model'}
            </button>
            <Link className="ui-button ui-button--secondary" to="/app/settings/ai">
              Open AI Settings
            </Link>
            <p className="ui-card__description">{settings.ai?.note}</p>
          </div>
        </Card>

        <PlaceholderSettingCard
          description="Future controls for upload retention windows, archive pruning, and per-module storage limits."
          icon={Database}
          title="Data Retention"
        />
        <PlaceholderSettingCard
          description="Future controls for role gating, internal-only routes, and webhook hardening."
          icon={Shield}
          title="Access Controls"
        />
        <PlaceholderSettingCard
          description="Future controls for default routes, module visibility, and environment-specific UI behavior."
          icon={SlidersHorizontal}
          title="Workspace Preferences"
        />
      </div>
    </section>
  );
}
