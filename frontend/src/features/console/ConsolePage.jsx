import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getSystemStatus } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { LogNotificationBanner } from './LogNotificationBanner';
import { LogsPanel } from './LogsPanel';

function formatServiceLabel(label) {
  if (label === 'frontend') {
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
  if (label === 'backend') {
    return '/health';
  }
  if (label === 'ai-gateway') {
    return '/api/ai/health';
  }
  if (label === 'frontend') {
    return '/';
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

  if (firstImpacted.label === 'frontend') {
    return 'backend';
  }

  return firstImpacted.label || 'backend';
}

export function ConsolePage() {
  const [services, setServices] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requestedLogContainer, setRequestedLogContainer] = useState('backend');
  const logsPanelRef = useRef(null);

  async function loadHealth() {
    setIsLoading(true);

    try {
      const result = await getSystemStatus();
      const status = result.data;
      const nextServices = [
        { label: 'backend', status: mapStatus(status.backend), details: status.details?.backend || {} },
        { label: 'ai-gateway', status: mapStatus(status.ai_gateway), details: status.details?.ai_gateway || {} },
        { label: 'frontend', status: mapStatus(status.frontend), details: status.details?.frontend || {} },
      ];
      setSystemStatus(status);
      setServices(nextServices);
      setRequestedLogContainer(getPreferredLogContainer(nextServices));
    } catch {
      setSystemStatus(null);
      const fallbackServices = [
        { label: 'backend', status: 'down', details: {} },
        { label: 'ai-gateway', status: 'down', details: {} },
        { label: 'frontend', status: 'down', details: {} },
      ];
      setServices(fallbackServices);
      setRequestedLogContainer(getPreferredLogContainer(fallbackServices));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadHealth();
  }, []);

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
                onClick={() => focusLogs(service.label)}
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

      <div className="console-service-grid">
        {services.map((service) => (
          <div
            key={service.label}
            className={`console-service-card console-service-card--${service.status}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                focusLogs(service.label);
              }
            }}
            onClick={() => focusLogs(service.label)}
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
              <small>{`Last check: ${systemStatus?.timestamp || 'n/a'}`}</small>
              <small>{`HTTP: ${service.details?.httpStatus || 'n/a'}`}</small>
            </div>
            <div className="console-service-card__actions">
              <button
                className="compact-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  focusLogs(service.label);
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
