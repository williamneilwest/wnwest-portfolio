import { useEffect, useState } from 'react';
import { Activity, Cpu, RefreshCcw, ServerCog } from 'lucide-react';
import { getSystemStatus } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';
import { SectionHeader } from '../../app/ui/SectionHeader';

export function ConsolePage() {
  const [services, setServices] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadHealth() {
      if (isMounted) {
        setIsLoading(true);
      }

      try {
        const result = await getSystemStatus();

        if (!isMounted) {
          return;
        }

        const status = result.data;
        setSystemStatus(status);
        setServices([
          { label: 'backend', status: status.backend },
          { label: 'ai-gateway', status: status.ai_gateway },
          { label: 'frontend', status: status.frontend }
        ]);
      } catch {
        if (!isMounted) {
          return;
        }

        setSystemStatus(null);
        setServices([
          { label: 'backend', status: 'down' },
          { label: 'ai-gateway', status: 'down' },
          { label: 'frontend', status: 'down' }
        ]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadHealth();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="module">
      <SectionHeader
        tag="/console"
        title="Console"
        description="A narrow status surface for service checks and runtime visibility."
        actions={
          <Button onClick={() => window.location.reload()} type="button" variant="secondary">
            <RefreshCcw size={15} />
            Refresh
          </Button>
        }
      />

      <div className="console-layout">
        <Card className="console-panel">
          <CardHeader eyebrow="Service map" title="Current health states" />
          <section className="console">
            <div className="console__row console__row--header">
              <span>service</span>
              <span>state</span>
            </div>
            {services.map((service) => (
              <div className="console__row" key={service.label}>
                <span className="console__service">
                  <i className={`status-dot status-dot--${service.status}`} />
                  {service.label}
                </span>
                <strong>{service.status}</strong>
              </div>
            ))}
          </section>
        </Card>

        <Card>
          <CardHeader eyebrow="Runtime summary" title="Backend status" />
          {systemStatus ? (
            <div className="stack-list">
              <div className="stack-row">
                <span>environment</span>
                <strong>{systemStatus.environment}</strong>
              </div>
              <div className="stack-row">
                <span>timestamp</span>
                <strong>{systemStatus.timestamp}</strong>
              </div>
              <div className="stack-row">
                <span>backend http</span>
                <strong>{systemStatus.details.backend.httpStatus || 'n/a'}</strong>
              </div>
              <div className="stack-row">
                <span>ai http</span>
                <strong>{systemStatus.details.ai_gateway.httpStatus || 'n/a'}</strong>
              </div>
              <div className="stack-row">
                <span>frontend state</span>
                <strong>{systemStatus.frontend}</strong>
              </div>
            </div>
          ) : isLoading ? (
            <div className="skeleton-stack">
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
            </div>
          ) : (
            <EmptyState
              icon={<ServerCog size={20} />}
              title="No status payload available"
              description="The status endpoint did not return structured runtime data."
            />
          )}
        </Card>
      </div>

      <div className="card-grid card-grid--compact">
        <Card>
          <div className="mini-stat">
            <Activity size={18} />
            <div>
              <span>Services tracked</span>
              <strong>{services.length}</strong>
            </div>
          </div>
        </Card>
        <Card>
          <div className="mini-stat">
            <Cpu size={18} />
            <div>
              <span>Healthy services</span>
              <strong>{services.filter((service) => service.status === 'ok').length}</strong>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
