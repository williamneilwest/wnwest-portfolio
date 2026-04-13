import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks/useCurrentUser';
import { getServices, getSystemStatus } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { GatedCard } from '../auth/GatedCard';
import { LogNotificationBanner } from './LogNotificationBanner';
import { LogsPanel } from './LogsPanel';

function formatServiceLabel(label) {
  if (label === 'frontend') {
    return 'UI (served by backend)';
  }
  if (label === 'ui') {
    return 'UI (served by backend)';
  }
  return String(label || '').replace(/[_-]+/g, ' ').trim();
}

function mapStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'ok') {
    return 'ok';
  }
  if (normalized === 'misconfigured') {
    return 'misconfigured';
  }
  if (normalized === 'degraded' || normalized === 'loading') {
    return 'degraded';
  }
  return 'down';
}

function buildOperationalSummary(services) {
  const down = services.filter((service) => service.status === 'down').map((service) => formatServiceLabel(service.label));
  const misconfigured = services
    .filter((service) => service.status === 'misconfigured')
    .map((service) => formatServiceLabel(service.label));
  const degraded = services.filter((service) => service.status === 'degraded').map((service) => formatServiceLabel(service.label));

  if (down.length) {
    const affected = [...down, ...misconfigured, ...degraded].join(' and ');
    return `${affected} ${down.length + misconfigured.length + degraded.length === 1 ? 'is' : 'are'} currently down or degraded.`;
  }
  if (misconfigured.length) {
    return `${misconfigured.join(' and ')} ${misconfigured.length === 1 ? 'is' : 'are'} reachable but using a misconfigured endpoint.`;
  }
  if (degraded.length) {
    return `${degraded.join(' and ')} ${degraded.length === 1 ? 'is' : 'are'} experiencing issues.`;
  }
  return 'All core services are currently healthy.';
}

function getServiceUrl(label) {
  const normalized = String(label || '').toLowerCase();

  if (normalized === 'backend') {
    return '/health';
  }
  if (normalized === 'ai-gateway') {
    return '/api/ai/health';
  }
  if (normalized === 'frontend' || normalized === 'ui') {
    return '/';
  }
  if (normalized === 'grafana' || normalized.includes('grafana')) {
    return 'https://grafana.westos.dev';
  }
  if (normalized === 'portainer' || normalized.includes('portainer')) {
    return 'https://portainer.westos.dev';
  }
  if (normalized === 'filebrowser' || normalized.includes('filebrowser') || normalized === 'files') {
    return 'https://files.westos.dev';
  }
  if (normalized === 'code-server' || normalized.includes('code-server') || normalized === 'code') {
    return 'https://code.westos.dev';
  }
  if (normalized === 'plex' || normalized.includes('plex')) {
    return 'https://plex.westos.dev';
  }
  if (normalized === 'qbittorrent' || normalized.includes('qbit') || normalized.includes('torrent')) {
    return 'https://torrent.westos.dev';
  }
  return '';
}

function getPreferredLogContainer(services) {
  const normalized = Array.isArray(services) ? services : [];
  const firstImpacted = normalized.find((service) =>
    ['down', 'degraded', 'misconfigured'].includes(String(service?.status || '').toLowerCase())
  );

  if (!firstImpacted) {
    return 'backend';
  }

  if (firstImpacted.label === 'frontend' || firstImpacted.label === 'ui') {
    return 'backend';
  }

  return firstImpacted.container || firstImpacted.label || 'backend';
}

function classifyServiceGroup(name) {
  const normalized = String(name || '').toLowerCase();
  if (normalized === 'backend' || normalized === 'ai-gateway' || normalized === 'frontend' || normalized === 'ui') {
    return 'Core Services';
  }

  if (
    normalized.includes('portainer')
    || normalized.includes('grafana')
    || normalized.includes('caddy')
    || normalized.includes('prometheus')
    || normalized.includes('loki')
    || normalized.includes('promtail')
    || normalized.includes('cadvisor')
    || normalized.includes('database')
    || normalized.includes('postgres')
  ) {
    return 'Infrastructure';
  }

  return 'Other';
}

function mapDockerHealth(health) {
  return String(health || '').toLowerCase() === 'healthy' ? 'ok' : 'down';
}

function mapCoreStatusByName(name, status) {
  const normalized = String(name || '').toLowerCase();
  if (normalized === 'backend') {
    return mapStatus(status?.backend);
  }
  if (normalized === 'ai-gateway') {
    return mapStatus(status?.ai_gateway);
  }
  if (normalized === 'frontend' || normalized === 'ui') {
    return mapStatus(status?.frontend);
  }
  return '';
}

export function ConsolePage() {
  const { loading: authLoading, authenticated, isAdmin } = useCurrentUser();
  const [services, setServices] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requestedLogContainer, setRequestedLogContainer] = useState('backend');
  const canViewModule = authenticated && isAdmin;
  const logsPanelRef = useRef(null);

  async function loadHealth() {
    setIsLoading(true);

    try {
      const [systemResult, servicesResult] = await Promise.all([getSystemStatus(), getServices()]);
      const status = systemResult?.data || {};
      const discovered = Array.isArray(servicesResult?.services) ? servicesResult.services : [];

      const nextServices = discovered.map((service) => {
        const label = String(service?.name || '').trim();
        const coreStatus = mapCoreStatusByName(label, status);
        return {
          label,
          container: label,
          status: coreStatus || mapDockerHealth(service?.health),
          details: {
            ...(status?.details?.[label] || {}),
            statusText: service?.status || '',
          },
          image: service?.image || 'n/a',
          ports: service?.ports || 'n/a',
          group: classifyServiceGroup(label),
        };
      });

      const hasUiEntry = nextServices.some((service) => String(service.label || '').toLowerCase() === 'frontend' || String(service.label || '').toLowerCase() === 'ui');
      if (!hasUiEntry) {
        nextServices.push({
          label: 'frontend',
          container: 'backend',
          status: mapStatus(status?.frontend),
          details: status?.details?.frontend || {},
          image: 'served-by-backend',
          ports: 'via backend',
          group: 'Core Services',
        });
      }
      if (!nextServices.some((service) => String(service.label || '').toLowerCase() === 'backend')) {
        nextServices.push({
          label: 'backend',
          container: 'backend',
          status: mapStatus(status?.backend),
          details: status?.details?.backend || {},
          image: 'n/a',
          ports: 'n/a',
          group: 'Core Services',
        });
      }
      if (!nextServices.some((service) => String(service.label || '').toLowerCase() === 'ai-gateway')) {
        nextServices.push({
          label: 'ai-gateway',
          container: 'ai-gateway',
          status: mapStatus(status?.ai_gateway),
          details: status?.details?.ai_gateway || {},
          image: 'n/a',
          ports: 'n/a',
          group: 'Core Services',
        });
      }

      setSystemStatus(status);
      setServices(nextServices);
      setRequestedLogContainer(getPreferredLogContainer(nextServices));
    } catch {
      setSystemStatus(null);
      const fallbackServices = [
        { label: 'backend', container: 'backend', status: 'down', details: {}, image: 'n/a', ports: 'n/a', group: 'Core Services' },
        { label: 'ai-gateway', container: 'ai-gateway', status: 'down', details: {}, image: 'n/a', ports: 'n/a', group: 'Core Services' },
        { label: 'frontend', container: 'backend', status: 'down', details: {}, image: 'served-by-backend', ports: 'via backend', group: 'Core Services' },
      ];
      setServices(fallbackServices);
      setRequestedLogContainer(getPreferredLogContainer(fallbackServices));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!canViewModule) {
      setServices([]);
      setSystemStatus(null);
      setRequestedLogContainer('backend');
      setIsLoading(false);
      return;
    }

    void loadHealth();
  }, [canViewModule]);

  const totalServices = services.length;
  const healthyCount = services.filter((service) => service.status === 'ok').length;
  const downCount = services.filter((service) => service.status === 'down').length;
  const warningCount = services.filter((service) => service.status === 'degraded').length;
  const misconfiguredCount = services.filter((service) => service.status === 'misconfigured').length;
  const overallState = downCount ? 'down' : warningCount || misconfiguredCount ? 'degraded' : 'healthy';
  const stateLabel = overallState === 'healthy' ? 'Healthy' : overallState === 'degraded' ? 'Degraded' : 'Down';
  const summaryText = buildOperationalSummary(services);
  const hasIssues = downCount > 0 || warningCount > 0 || misconfiguredCount > 0;
  const impactedServices = services.filter((service) => service.status !== 'ok');
  const groupedServices = useMemo(() => {
    const groups = {
      'Core Services': [],
      Infrastructure: [],
      Other: [],
    };
    services.forEach((service) => {
      const groupName = groups[service.group] ? service.group : 'Other';
      groups[groupName].push(service);
    });
    return groups;
  }, [services]);

  function focusLogs(container = '') {
    if (container) {
      setRequestedLogContainer(container);
    }
    logsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openService(label) {
    const url = getServiceUrl(label);
    if (!url) {
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const runtimeMeta = useMemo(
    () => [
      { label: 'environment', value: systemStatus?.environment || 'unknown' },
      { label: 'timestamp', value: systemStatus?.timestamp || 'n/a' },
      { label: 'backend http', value: systemStatus?.details?.backend?.httpStatus || 'n/a' },
      { label: 'ai http', value: systemStatus?.details?.ai_gateway?.httpStatus || 'n/a' },
    ],
    [systemStatus]
  );

  if (authLoading) {
    return <section className="module"><p className="status-text">Checking authorization...</p></section>;
  }

  if (!authenticated) {
    return (
      <section className="module">
        <SectionHeader
          tag="/console"
          title="Console"
          description="Operational dashboard for service health and logs."
        />
        <GatedCard message="Sign in to view this module" />
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="module">
        <SectionHeader
          tag="/console"
          title="Console"
          description="Operational dashboard for service health and logs."
        />
        <GatedCard
          title="Admin access required"
          message="Your account does not have permission to view console telemetry and logs."
          showAction={false}
        />
      </section>
    );
  }

  return (
    <section className="module">
      <SectionHeader
        tag="/console"
        title="Console"
        description="Operational dashboard for service health and logs."
      />

      <Card className={`console-status-strip console-status-strip--${overallState}`}>
        <div className="console-status-strip__main">
          <div className="console-status-strip__state">
            <i className={`status-dot status-dot--${overallState === 'healthy' ? 'ok' : overallState}`} />
            <strong>{stateLabel}</strong>
          </div>
          <p>{isLoading ? 'Refreshing service health...' : summaryText}</p>
        </div>
        <div className="console-status-strip__actions">
          <Button onClick={() => void loadHealth()} type="button" variant="secondary">
            <RefreshCcw size={15} />
            Refresh
          </Button>
          <Button onClick={() => focusLogs()} type="button" variant="secondary">
            View Logs
          </Button>
        </div>
      </Card>

      <div className="console-runtime-meta">
        {runtimeMeta.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>

      <LogNotificationBanner onExpandLogs={() => focusLogs()} />

      <div className="console-stats-strip">
        <span className="console-stat-pill">
          <Activity size={15} />
          Total: {totalServices}
        </span>
        <span className="console-stat-pill console-stat-pill--ok">
          <CheckCircle2 size={15} />
          Healthy: {healthyCount}
        </span>
        <span className="console-stat-pill console-stat-pill--warning">
          <AlertTriangle size={15} />
          Warning: {warningCount}
        </span>
        <span className="console-stat-pill console-stat-pill--warning">
          <AlertTriangle size={15} />
          Misconfigured: {misconfiguredCount}
        </span>
        <span className="console-stat-pill console-stat-pill--down">
          <Cpu size={15} />
          Down: {downCount}
        </span>
      </div>

      {hasIssues ? (
        <Card className="console-actions-row">
          <CardHeader eyebrow="Actions" title="Issue response actions" />
          <div className="table-actions">
            {impactedServices.map((service) => (
              <button
                key={`${service.label}-logs`}
                className="compact-toggle"
                onClick={() => focusLogs(service.container || service.label)}
                type="button"
              >
                {`View ${formatServiceLabel(service.label)} logs`}
              </button>
            ))}
            <button className="compact-toggle" type="button" disabled>
              Restart container (coming soon)
            </button>
          </div>
        </Card>
      ) : null}

      {Object.entries(groupedServices).map(([groupName, groupItems]) => (
        groupItems.length ? (
          <div key={groupName}>
            <SectionHeader tag="/console/services" title={groupName} description={`${groupItems.length} service${groupItems.length === 1 ? '' : 's'}`} />
            <div className="console-service-grid">
              {groupItems.map((service) => (
                <div
                  key={`${groupName}-${service.label}`}
                  className={`console-service-card console-service-card--${service.status}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      focusLogs(service.container || service.label);
                    }
                  }}
                  onClick={() => focusLogs(service.container || service.label)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="console-service-card__header">
                    <span className="console__service">
                      <i className={`status-dot status-dot--${service.status}`} />
                      {formatServiceLabel(service.label)}
                    </span>
                    <strong>{service.status}</strong>
                  </div>
                  <div className="console-service-card__meta">
                    <small>{`Image: ${service.image || 'n/a'}`}</small>
                    <small>{`Ports: ${service.ports || 'n/a'}`}</small>
                    <small>{`HTTP: ${service.details?.httpStatus || 'n/a'}`}</small>
                  </div>
                  <div className="console-service-card__actions">
                    <button
                      className="compact-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        focusLogs(service.container || service.label);
                      }}
                      type="button"
                    >
                      View logs
                    </button>
                    <button
                      className="compact-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        openService(service.label);
                      }}
                      type="button"
                    >
                      Open service
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null
      ))}

      <details className="console-endpoints-module">
        <summary>API Endpoints Registry</summary>
        <Card>
          <CardHeader
            eyebrow="Console module"
            title="API Endpoints Registry"
            description="Open dedicated table page for backend route catalog."
            action={
              <Link className="compact-toggle" to="/app/console/endpoints" state={{ from: '/app/console', label: 'Console' }}>
                Open Table
              </Link>
            }
          />
          <p className="status-text">Collapsed by default to keep operational status primary.</p>
        </Card>
      </details>

      <div id="logs-panel" ref={logsPanelRef}>
        <LogsPanel requestedContainer={requestedLogContainer} />
      </div>
    </section>
  );
}
