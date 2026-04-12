import { Bot, BrainCircuit, Cpu, ExternalLink, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAISettings, updateAISettings } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { AIInteractionsViewer } from '../ai/components/AIInteractionsViewer';

const EMPTY_FORM = {
  models: {
    preview: '',
    focused: '',
    deep: '',
    document_processing: '',
  },
  pipeline: {
    preview_max_rows: 10,
    focused_max_rows: 5,
    enable_chunking: true,
  },
};

function buildFormFromSettings(result) {
  return {
    models: {
      preview: result?.models?.preview || '',
      focused: result?.models?.focused || '',
      deep: result?.models?.deep || '',
      document_processing: result?.models?.document_processing || '',
    },
    pipeline: {
      preview_max_rows: Number(result?.pipeline?.preview_max_rows || 10),
      focused_max_rows: Number(result?.pipeline?.focused_max_rows || 5),
      enable_chunking: Boolean(result?.pipeline?.enable_chunking),
    },
  };
}

function NumericInput({ id, label, value, onChange, changed = false }) {
  return (
    <label className={`column-filter__label ai-field${changed ? ' ai-field--changed' : ''}`} htmlFor={id}>
      <span>{label}</span>
      <input
        className="ticket-queue__filter"
        id={id}
        min="1"
        onChange={(event) => onChange(Number(event.target.value || 1))}
        type="number"
        value={value}
      />
    </label>
  );
}

function ModelSelect({ id, label, value, options, onChange, changed = false }) {
  return (
    <label className={`column-filter__label ai-field${changed ? ' ai-field--changed' : ''}`} htmlFor={id}>
      <span>{label}</span>
      <select className="ticket-queue__filter" id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Select model</option>
        {options.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AISettingsPage() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    getAISettings()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setSettings(result);
        setForm(buildFormFromSettings(result));
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(requestError.message || 'AI settings could not be loaded.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function updateModel(key, value) {
    setForm((current) => ({
      ...current,
      models: {
        ...current.models,
        [key]: value,
      },
    }));
  }

  function updatePipeline(key, value) {
    setForm((current) => ({
      ...current,
      pipeline: {
        ...current.pipeline,
        [key]: value,
      },
    }));
  }

  const baseForm = useMemo(() => (settings ? buildFormFromSettings(settings) : EMPTY_FORM), [settings]);
  const hasChanges = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseForm), [baseForm, form]);
  const saveStateLabel = hasChanges ? 'Unsaved changes' : 'Saved';

  async function handleSave() {
    if (!form.models.preview || !form.models.focused || !form.models.deep || !form.models.document_processing) {
      setError('All model selections are required.');
      return;
    }

    setError('');
    setSuccessMessage('');
    setIsSaving(true);

    try {
      const result = await updateAISettings(form);
      setSettings(result);
      setForm(buildFormFromSettings(result));
      setSuccessMessage('AI settings saved.');
    } catch (requestError) {
      setError(requestError.message || 'AI settings could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return (
      <section className="module">
        <SectionHeader tag="/app/ai" title="AI" description="Model routing and pipeline controls." />
        <EmptyState
          icon={<SlidersHorizontal size={20} />}
          title="Loading AI settings"
          description={error || 'Fetching saved AI configuration.'}
        />
      </section>
    );
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/app/ai"
        title="AI"
        description="Configure stage-specific AI models and tune the analysis pipeline."
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {successMessage ? <p className="status-text">{successMessage}</p> : null}

      <div className="ai-pipeline">
        <div className="ai-pipeline__flow">
          <span>Models</span>
          <small>→</small>
          <span>Dataset Limits</span>
          <small>→</small>
          <span>Apply</span>
        </div>

        <div className="ai-pipeline__layout">
          <div className="ai-pipeline__main">
            <Card className="landing__card">
              <CardHeader
                eyebrow="Model Configuration"
                title="Analysis Models"
                description={`Provider: ${settings.provider || 'unknown'}. These models control each stage of the analysis pipeline.`}
              />
              <div className="ai-settings-grid">
                <ModelSelect
                  changed={form.models.preview !== baseForm.models.preview}
                  id="preview-model"
                  label="Preview Model"
                  onChange={(value) => updateModel('preview', value)}
                  options={settings.availableModels || []}
                  value={form.models.preview}
                />
                <ModelSelect
                  changed={form.models.focused !== baseForm.models.focused}
                  id="focused-model"
                  label="Focused Model"
                  onChange={(value) => updateModel('focused', value)}
                  options={settings.availableModels || []}
                  value={form.models.focused}
                />
                <ModelSelect
                  changed={form.models.deep !== baseForm.models.deep}
                  id="deep-model"
                  label="Deep Model"
                  onChange={(value) => updateModel('deep', value)}
                  options={settings.availableModels || []}
                  value={form.models.deep}
                />
                <ModelSelect
                  changed={form.models.document_processing !== baseForm.models.document_processing}
                  id="document-processing-model"
                  label="Document Processing Model"
                  onChange={(value) => updateModel('document_processing', value)}
                  options={settings.availableModels || []}
                  value={form.models.document_processing}
                />
              </div>
            </Card>

            <Card className="landing__card">
              <CardHeader
                eyebrow="Pipeline Controls"
                title="Dataset & Processing Limits"
                description="Limits control how much data is processed before AI is invoked."
              />
              <div className="ai-limits-row">
                <NumericInput
                  changed={form.pipeline.preview_max_rows !== baseForm.pipeline.preview_max_rows}
                  id="preview-max-rows"
                  label="Preview max rows"
                  onChange={(value) => updatePipeline('preview_max_rows', value)}
                  value={form.pipeline.preview_max_rows}
                />
                <NumericInput
                  changed={form.pipeline.focused_max_rows !== baseForm.pipeline.focused_max_rows}
                  id="focused-max-rows"
                  label="Focused max rows"
                  onChange={(value) => updatePipeline('focused_max_rows', value)}
                  value={form.pipeline.focused_max_rows}
                />
                <label
                  className={`column-filter__label ai-settings__toggle${form.pipeline.enable_chunking !== baseForm.pipeline.enable_chunking ? ' ai-field--changed' : ''}`}
                  htmlFor="enable-chunking"
                >
                  <span>Enable chunking</span>
                  <input
                    checked={form.pipeline.enable_chunking}
                    id="enable-chunking"
                    onChange={(event) => updatePipeline('enable_chunking', event.target.checked)}
                    type="checkbox"
                  />
                </label>
              </div>
            </Card>

            <Card className="landing__card ai-utility-card">
              <CardHeader
                eyebrow="Utility"
                title="Open WebUI"
                description="Optional external AI workspace."
              />
              <div className="landing__actions">
                <a className="ui-button ui-button--secondary" href="https://webui.westos.dev" rel="noreferrer">
                  <ExternalLink size={16} />
                  Open WebUI
                </a>
              </div>
            </Card>

            <AIInteractionsViewer />
          </div>

          <aside className="ai-pipeline__apply">
            <Card className="landing__card ai-apply-card">
              <CardHeader
                eyebrow="Apply"
                title="Apply Configuration"
                description={settings.note || 'Settings apply immediately to new requests.'}
              />
              <div className="ai-apply-state">
                <span className={`ai-state-pill${hasChanges ? ' ai-state-pill--warning' : ''}`}>{saveStateLabel}</span>
              </div>
              <div className="landing__actions">
                <button
                  className="ui-button ui-button--primary"
                  disabled={isSaving || !hasChanges}
                  onClick={handleSave}
                  type="button"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : 'Save AI Settings'}
                </button>
                <button
                  className="compact-toggle"
                  disabled={isSaving || !hasChanges}
                  onClick={() => setForm(baseForm)}
                  type="button"
                >
                  Reset
                </button>
              </div>
              <div className="signal-panel__item">
                <span className="icon-badge">
                  <Bot size={16} />
                </span>
                <div>
                  <strong>Preview</strong>
                  <p>{form.models.preview || 'Not configured'}</p>
                </div>
              </div>
              <div className="signal-panel__item">
                <span className="icon-badge">
                  <Cpu size={16} />
                </span>
                <div>
                  <strong>Deep Analysis</strong>
                  <p>{form.models.deep || 'Not configured'}</p>
                </div>
              </div>
              <div className="signal-panel__item">
                <span className="icon-badge">
                  <BrainCircuit size={16} />
                </span>
                <div>
                  <strong>Document Processing</strong>
                  <p>{form.models.document_processing || 'Not configured'}</p>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </section>
  );
}
