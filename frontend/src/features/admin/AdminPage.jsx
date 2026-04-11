import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';

export function AdminPage() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch('/api/reference/endpoints');
        if (!response.ok) {
          throw new Error(`Endpoints request failed: ${response.status}`);
        }

        const data = await response.json();
        if (!ignore) {
          setEndpoints(Array.isArray(data) ? data : []);
        }
      } catch (requestError) {
        if (!ignore) {
          setError(String(requestError.message || requestError));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="module">
      <SectionHeader
        tag="/app/admin"
        title="Admin"
        description="Admin tools grouped in one place. The API Endpoints Registry is the first admin card."
      />

      <div className="card-grid">
        <Card className="reference-card reference-card--wide">
          <CardHeader
            eyebrow="Admin Tool"
            title="API Endpoints Registry"
            description="Dynamically synced list of backend routes with methods and descriptions."
          />

          {error ? (
            <p className="status-text status-text--error">{error}</p>
          ) : loading ? (
            <p>Loading…</p>
          ) : endpoints.length ? (
            <div className="data-table-wrap reference-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Methods</th>
                    <th>Path</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((endpoint) => (
                    <tr key={endpoint.id}>
                      <td>
                        <span className="data-table__cell-content" title={endpoint.name}>
                          {endpoint.name}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={endpoint.methods}>
                          {endpoint.methods}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={endpoint.rule}>
                          {endpoint.rule}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={endpoint.description}>
                          {endpoint.description || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No endpoints found.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
