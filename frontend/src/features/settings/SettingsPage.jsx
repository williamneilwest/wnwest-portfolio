import { Database, Shield, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSettings } from '../../app/services/api';
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
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    getSettings()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        const nextSettings = result;
        setSettings(nextSettings);
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
