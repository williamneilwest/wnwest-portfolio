import { Bot, Cpu, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAISettings, updateAISettings } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';


const EMPTY_FORM = {
  models: {
    preview: '',
    focused: '',
    deep: '',
  },
  pipeline: {
    preview_max_rows: 10,
    focused_max_rows: 5,
    enable_chunking: true,
  },
};


function NumericInput({ id, label, value, onChange }) {
  return (
    <label className="column-filter__label" htmlFor={id}>
      {label}
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


function ModelSelect({ id, label, value, options, onChange }) {
  return (
    <label className="column-filter__label" htmlFor={id}>
      {label}
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
        setForm({
          models: {
            preview: result.models?.preview || '',
            focused: result.models?.focused || '',
            deep: result.models?.deep || '',
          },
          pipeline: {
            preview_max_rows: Number(result.pipeline?.preview_max_rows || 10),
            focused_max_rows: Number(result.pipeline?.focused_max_rows || 5),
            enable_chunking: Boolean(result.pipeline?.enable_chunking),
          },
        });
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

  async function handleSave() {
    if (!form.models.preview || !form.models.focused || !form.models.deep) {
      setError('All model selections are required.');
      return;
    }

    setError('');
    setSuccessMessage('');
    setIsSaving(true);

    try {
      const result = await updateAISettings(form);
      setSettings(result);
      setForm({
        models: {
          preview: result.models?.preview || '',
          focused: result.models?.focused || '',
          deep: result.models?.deep || '',
        },
        pipeline: {
          preview_max_rows: Number(result.pipeline?.preview_max_rows || 10),
          focused_max_rows: Number(result.pipeline?.focused_max_rows || 5),
          enable_chunking: Boolean(result.pipeline?.enable_chunking),
        },
      });
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
        <SectionHeader tag="/app/settings/ai" title="AI Settings" description="Model routing and pipeline controls." />
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
        tag="/app/settings/ai"
        title="AI Settings"
        description="Select models per analysis stage and tune lightweight pipeline behavior."
      />

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {successMessage ? <p className="status-text">{successMessage}</p> : null}

      <div className="card-grid">
        <Card className="landing__card">
          <CardHeader
            eyebrow="Model Selection"
            title="Analysis Models"
            description={`Provider: ${settings.provider || 'unknown'}. Stage-specific models are sent dynamically with each AI request.`}
          />
          <div className="upload-form">
            <ModelSelect
              id="preview-model"
              label="Preview Model"
              onChange={(value) => updateModel('preview', value)}
              options={settings.availableModels || []}
              value={form.models.preview}
            />
            <ModelSelect
              id="focused-model"
              label="Focused Model"
              onChange={(value) => updateModel('focused', value)}
              options={settings.availableModels || []}
              value={form.models.focused}
            />
            <ModelSelect
              id="deep-model"
              label="Deep Model"
              onChange={(value) => updateModel('deep', value)}
              options={settings.availableModels || []}
              value={form.models.deep}
            />
          </div>
        </Card>

        <Card className="landing__card">
          <CardHeader
            eyebrow="Pipeline Controls"
            title="Dataset Limits"
            description="Tune how much data each lightweight stage uses before AI requests are sent."
          />
          <div className="upload-form">
            <NumericInput
              id="preview-max-rows"
              label="Preview max rows"
              onChange={(value) => updatePipeline('preview_max_rows', value)}
              value={form.pipeline.preview_max_rows}
            />
            <NumericInput
              id="focused-max-rows"
              label="Focused max rows"
              onChange={(value) => updatePipeline('focused_max_rows', value)}
              value={form.pipeline.focused_max_rows}
            />
            <label className="column-filter__label ai-settings__toggle" htmlFor="enable-chunking">
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

        <Card className="landing__card">
          <CardHeader
            eyebrow="Save"
            title="Apply Configuration"
            description={settings.note || 'Settings apply immediately to new requests.'}
          />
          <div className="landing__actions">
            <button className="ui-button ui-button--primary" disabled={isSaving} onClick={handleSave} type="button">
              <Save size={16} />
              {isSaving ? 'Saving...' : 'Save AI Settings'}
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
        </Card>
      </div>
    </section>
  );
}
