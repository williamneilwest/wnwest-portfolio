import { ArrowDown, ArrowUp, Database, RotateCcw, Shield, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../app/ui/Button';
import { getSettings } from '../../app/services/api';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { modules } from '../../app/shell/modules';
import { clearNavPreferences, getNavPreferences, setNavPreferences } from '../../app/utils/navPreferences';
import { storage } from '../../app/utils/storage';

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
  const navigate = useNavigate();
  const { isAdmin } = useCurrentUser();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [navPrefs, setNavPrefs] = useState(() => getNavPreferences());

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

  const configurableModules = useMemo(
    () =>
      modules.filter((module) => module.href !== '/app/settings').map((module) => ({
        ...module,
        hidden: navPrefs.hidden.includes(module.href),
      })),
    [navPrefs.hidden]
  );

  const orderedModules = useMemo(() => {
    const order = new Map((navPrefs.order || []).map((href, index) => [href, index]));
    return [...configurableModules].sort((left, right) => {
      const leftIndex = order.has(left.href) ? order.get(left.href) : Number.MAX_SAFE_INTEGER;
      const rightIndex = order.has(right.href) ? order.get(right.href) : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return left.label.localeCompare(right.label);
    });
  }, [configurableModules, navPrefs.order]);

  function persistNext(next) {
    setNavPrefs(next);
    setNavPreferences(next);
  }

  function toggleModuleVisibility(href) {
    const hiddenSet = new Set(navPrefs.hidden || []);
    if (hiddenSet.has(href)) {
      hiddenSet.delete(href);
    } else {
      hiddenSet.add(href);
    }
    persistNext({
      order: navPrefs.order || [],
      hidden: Array.from(hiddenSet),
    });
  }

  function moveModule(href, direction) {
    const currentOrder = (navPrefs.order || []).filter((item) => item !== '/app/settings');
    const allHrefs = orderedModules.map((item) => item.href);
    const baseOrder = currentOrder.length ? currentOrder : allHrefs;
    const nextOrder = [...baseOrder];
    const currentIndex = nextOrder.indexOf(href);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= nextOrder.length) {
      return;
    }
    const [moved] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    persistNext({
      order: nextOrder,
      hidden: navPrefs.hidden || [],
    });
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
      {message ? <p className="status-text">{message}</p> : null}

      <div className="stack-row__actions" style={{ marginBottom: '1rem' }}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            storage.clearAll();
            setMessage('Local data cleared');
          }}
        >
          Clear Local Data
        </Button>
      </div>

      <div className="card-grid">
        <PlaceholderSettingCard
          description="Future controls for upload retention windows, archive pruning, and per-module storage limits."
          icon={Database}
          title="Data Retention"
        />
        <Card className="landing__card">
          <CardHeader
            eyebrow="Access"
            title="Access Controls"
            description="Role gating and access utilities. Profile settings are available here."
          />
          <div className="landing__actions">
            <button type="button" className="compact-toggle" onClick={() => navigate('/app/profile')}>
              Open Profile
            </button>
            <span className="icon-badge">
              <Shield size={18} />
            </span>
          </div>
        </Card>
        <PlaceholderSettingCard
          description="Future controls for default routes, module visibility, and environment-specific UI behavior."
          icon={SlidersHorizontal}
          title="Workspace Preferences"
        />
      </div>

      <Card className="reference-card reference-card--wide">
        <CardHeader
          eyebrow="System"
          title="System Pages"
          description="Access pages moved out of sidebar tabs."
        />
        <div className="stack-row__actions">
          {isAdmin ? (
            <>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/system')}>
                System Viewer
              </button>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/flows')}>
                Flows
              </button>
              <button type="button" className="compact-toggle" onClick={() => navigate('/app/dev/designer')}>
                Dev
              </button>
            </>
          ) : null}
        </div>
      </Card>

      {isAdmin ? (
        <Card className="reference-card reference-card--wide">
          <CardHeader
            eyebrow="Admin"
            title="Sidebar Navigation"
            description="Add/remove and rearrange sidebar module options."
            action={
              <button
                type="button"
                className="compact-toggle"
                onClick={() => {
                  clearNavPreferences();
                  setNavPrefs(getNavPreferences());
                }}
              >
                <RotateCcw size={14} />
                Reset
              </button>
            }
          />
          <div className="stack-list">
            {orderedModules.map((module, index) => (
              <div className="stack-row" key={`nav-pref-${module.href}`}>
                <span className="stack-row__label">
                  <span>
                    <strong>{module.label}</strong>
                    <small>{module.href}</small>
                  </span>
                </span>
                <div className="stack-row__actions">
                  <button
                    type="button"
                    className="compact-toggle"
                    onClick={() => moveModule(module.href, 'up')}
                    disabled={index === 0}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="compact-toggle"
                    onClick={() => moveModule(module.href, 'down')}
                    disabled={index === orderedModules.length - 1}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className={module.hidden ? 'compact-toggle' : 'compact-toggle compact-toggle--active'}
                    onClick={() => toggleModuleVisibility(module.href)}
                  >
                    {module.hidden ? 'Show' : 'Hide'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </section>
  );
}
