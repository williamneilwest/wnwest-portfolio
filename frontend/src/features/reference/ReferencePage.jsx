import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { Card, CardHeader } from '../../app/ui/Card';
import { setCachedWorkDataset } from '../work/workDatasetCache';

export function ReferencePage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [groupsRes, usersRes] = await Promise.all([
          fetch('/api/reference/groups'),
          fetch('/api/reference/users')
        ]);

        if (!groupsRes.ok) throw new Error(`Groups request failed: ${groupsRes.status}`);
        if (!usersRes.ok) throw new Error(`Users request failed: ${usersRes.status}`);

        const [groupsData, usersData] = await Promise.all([
          groupsRes.json(),
          usersRes.json()
        ]);
        if (!ignore) {
          setGroups(Array.isArray(groupsData) ? groupsData : []);
          setUsers(Array.isArray(usersData) ? usersData : []);
        }
      } catch (err) {
        if (!ignore) setError(String(err.message || err));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, []);

  function openCachedTable({ fileName, rows, columns }) {
    setCachedWorkDataset({
      fileName,
      rows,
      columns,
      sourceUrl: '',
    });
    navigate('/app/work/table');
  }

  return (
    <section className="module">
      <SectionHeader tag="Reference" title="Reference Data" description="Master data for groups and users." />

      <div className="module__grid reference-grid">
        <Card className="reference-card">
          <CardHeader
            eyebrow="Groups"
            title="Groups"
            description="List of master groups from Reference Data"
            action={
              <button
                type="button"
                className="compact-toggle"
                onClick={() => openCachedTable({ fileName: 'Reference Groups', rows: groups, columns: ['id', 'name'] })}
                disabled={!groups.length}
              >
                Open Table
              </button>
            }
          />

          {error ? (
            <p className="status-text--error">{error}</p>
          ) : loading ? (
            <p>Loading…</p>
          ) : groups.length ? (
            <div className="data-table-wrap reference-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <span className="data-table__cell-content" title={g.id}>
                          {g.id}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={g.name}>
                          {g.name || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No groups found.</p>
          )}
        </Card>

        <Card className="reference-card">
          <CardHeader
            eyebrow="Users"
            title="Users"
            description="List of master users from Reference Data"
            action={
              <button
                type="button"
                className="compact-toggle"
                onClick={() =>
                  openCachedTable({ fileName: 'Reference Users', rows: users, columns: ['id', 'name', 'email'] })
                }
                disabled={!users.length}
              >
                Open Table
              </button>
            }
          />

          {error ? (
            <p className="status-text--error">{error}</p>
          ) : loading ? (
            <p>Loading…</p>
          ) : users.length ? (
            <div className="data-table-wrap reference-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <span className="data-table__cell-content" title={user.id}>
                          {user.id}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={user.name}>
                          {user.name || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={user.email}>
                          {user.email || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No users found.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

export default ReferencePage;
