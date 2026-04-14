import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCcw } from 'lucide-react';
import { getLogs } from '../../app/services/api';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';

const DEFAULT_TAIL = 200;

function formatTimestamp(value) {
  if (!value) {
    return 'Not refreshed yet';
  }
  return value.toLocaleString();
}

export function LogsPanel({ requestedContainer = '', autoOpen = false }) {
  const [selectedSource, setSelectedSource] = useState('docker');
  const [containers, setContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState('');
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lineFilter, setLineFilter] = useState('');
  const [controlsOpen, setControlsOpen] = useState(() => {
    if (typeof document === 'undefined') {
      return true;
    }
    return !document.documentElement.classList.contains('is-mobile');
  });
  const logBoxRef = useRef(null);

  const canFetchLogs = useMemo(() => Boolean(selectedContainer), [selectedContainer]);
  const filteredLogs = useMemo(() => {
    const baseLogs = String(logs || '');
    const filterText = String(lineFilter || '').trim().toLowerCase();
    if (!filterText) {
      return baseLogs;
    }

    return baseLogs
      .split('\n')
      .filter((line) => line.toLowerCase().includes(filterText))
      .join('\n');
  }, [lineFilter, logs]);

  async function loadContainers() {
    setError('');
    try {
      const payload = await getLogs({ source: selectedSource, tail: DEFAULT_TAIL });
      const names = Array.isArray(payload?.availableContainers) ? payload.availableContainers : [];
      setContainers(names);
      if (!names.includes(selectedContainer)) {
        setSelectedContainer(names[0] || '');
      }
    } catch (requestError) {
      setContainers([]);
      setSelectedContainer('');
      setError(requestError.message || 'Container list could not be loaded.');
    }
  }

  async function loadLogs(containerName) {
    if (!containerName) {
      setLogs('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = await getLogs({ source: selectedSource, container: containerName, tail: DEFAULT_TAIL });
      setLogs(String(payload?.logs || ''));
      setLastUpdated(new Date());
    } catch (requestError) {
      setLogs('');
      setError(requestError.message || 'Logs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource]);

  useEffect(() => {
    if (!requestedContainer) {
      return;
    }
    if (!containers.includes(requestedContainer)) {
      return;
    }
    setSelectedContainer(requestedContainer);
  }, [containers, requestedContainer]);

  useEffect(() => {
    if (!autoOpen || !requestedContainer) {
      return;
    }
    if (!containers.includes(requestedContainer)) {
      return;
    }
    void loadLogs(requestedContainer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, containers, requestedContainer]);

  useEffect(() => {
    if (!selectedContainer) {
      setLogs('');
      return;
    }
    void loadLogs(selectedContainer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContainer]);

  useEffect(() => {
    if (!autoRefresh || !selectedContainer) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadLogs(selectedContainer);
    }, 10000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedContainer, selectedSource]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  async function copyLogs() {
    if (!filteredLogs) {
      return;
    }

    try {
      await navigator.clipboard.writeText(filteredLogs);
    } catch {
      // No-op; copy support depends on browser context.
    }
  }

  return (
    <Card className="analysis-grid__wide">
      <CardHeader
        eyebrow="Logs"
        title="Runtime log viewer"
        description="Backend-controlled log access for troubleshooting."
        action={
          <div className="table-actions">
            <Button type="button" variant="secondary" onClick={() => void loadLogs(selectedContainer)} disabled={!canFetchLogs || loading}>
              <RefreshCcw size={15} />
              Refresh Logs
            </Button>
            <Button type="button" variant="secondary" onClick={() => void copyLogs()} disabled={!logs}>
              <Copy size={15} />
              Copy
            </Button>
          </div>
        }
      />

      <button
        type="button"
        className="compact-toggle logs-toolbar__toggle"
        onClick={() => setControlsOpen((current) => !current)}
        aria-expanded={controlsOpen}
      >
        {controlsOpen ? 'Hide controls' : 'Show controls'}
      </button>

      <div className={controlsOpen ? 'logs-toolbar logs-toolbar--open' : 'logs-toolbar logs-toolbar--collapsed'}>
        <label className="settings-field">
          <span>Source</span>
          <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
            <option value="docker">Docker Logs</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Container</span>
          <select
            value={selectedContainer}
            onChange={(event) => setSelectedContainer(event.target.value)}
            disabled={!containers.length}
          >
            {containers.length ? (
              containers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))
            ) : (
              <option value="">No running containers</option>
            )}
          </select>
        </label>

        <label className="settings-field">
          <span>Quick filter</span>
          <input
            type="text"
            value={lineFilter}
            onChange={(event) => setLineFilter(event.target.value)}
            placeholder="Filter log lines..."
          />
        </label>

        <label className="logs-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto refresh (10s)
        </label>
      </div>

      <div className="logs-meta">
        <small>Last updated: {formatTimestamp(lastUpdated)}</small>
      </div>

      {error ? <p className="status-text status-text--error">{error}</p> : null}
      {loading ? <p className="status-text">Loading logs...</p> : null}

      <pre className="logs-viewer" ref={logBoxRef}>
        {filteredLogs || (selectedContainer ? 'No log output returned.' : 'Select a container to view logs.')}
      </pre>
    </Card>
  );
}
