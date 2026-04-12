import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getReferenceGroups,
  getReferenceUsers,
  upsertReferenceGroups,
  upsertReferenceUsers,
} from '../../app/services/api';
import { SectionHeader } from '../../app/ui/SectionHeader';
import { Card, CardHeader } from '../../app/ui/Card';
import { setCachedWorkDataset } from '../work/workDatasetCache';
import { parseCsvText } from '../work/workDatasetCache';

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function findColumn(columns, patterns) {
  return columns.find((column) => patterns.some((pattern) => pattern.test(column))) || '';
}

function mapGroupRows(rows, columns) {
  const idColumn = findColumn(columns, [/^id$/i, /group.*id/i, /aad.*id/i]);
  const nameColumn = findColumn(columns, [/^name$/i, /group.*name/i, /display.*name/i]);
  const descriptionColumn = findColumn(columns, [/description/i]);
  const tagsColumn = findColumn(columns, [/^tags?$/i]);

  return rows
    .map((row) => ({
      id: normalizeValue(row[idColumn]),
      name: normalizeValue(row[nameColumn]),
      description: normalizeValue(row[descriptionColumn]),
      tags: normalizeValue(row[tagsColumn]),
    }))
    .filter((row) => row.id);
}

function mapUserRows(rows, columns) {
  // Try a broad set of common variants for user id/header names.
  const idColumn = findColumn(columns, [
    /^id$/i,
    /^user_id$/i,
    /^userid$/i,
    /^uid$/i,
    /user.*id/i,
    /employee.*id/i,
    /personnel.*(number|no)/i,
    /aad.*id/i,
    /object.*id/i,
    /opid/i,
  ]);

  // Name columns are often provided as a single display/full name, but
  // sometimes come split into first/given and last/family names.
  const nameColumn = findColumn(columns, [/^name$/i, /display.*name/i, /full.*name/i, /^cn$/i]);
  const firstNameColumn = nameColumn
    ? ''
    : findColumn(columns, [/^first_?name$/i, /given_?name/i, /forename/i]);
  const lastNameColumn = nameColumn
    ? ''
    : findColumn(columns, [/^last_?name$/i, /surname/i, /family_?name/i]);

  // Support common email/User Principal Name variants.
  const emailColumn = findColumn(columns, [/^email$/i, /mail/i, /userprincipalname/i, /^upn$/i]);

  return rows
    .map((row) => {
      const id = normalizeValue(row[idColumn]);

      // Prefer single name field; otherwise try to compose from first/last.
      const composedName = [normalizeValue(row[firstNameColumn]), normalizeValue(row[lastNameColumn])]
        .filter(Boolean)
        .join(' ');
      const name = normalizeValue(row[nameColumn]) || composedName;

      const email = normalizeValue(row[emailColumn]);

      return { id, name, email };
    })
    .filter((row) => row.id);
}

export function ReferencePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadingTarget, setUploadingTarget] = useState('');
  const groupsInputRef = useRef(null);
  const usersInputRef = useRef(null);

  async function loadReferenceData(signalGuard = { ignore: false }) {
    setLoading(true);
    setError('');

    try {
      const [groupsData, usersData] = await Promise.all([getReferenceGroups(), getReferenceUsers()]);
      if (!signalGuard.ignore) {
        setGroups(Array.isArray(groupsData) ? groupsData : []);
        setUsers(Array.isArray(usersData) ? usersData : []);
      }
    } catch (err) {
      if (!signalGuard.ignore) {
        setError(String(err.message || err));
      }
    } finally {
      if (!signalGuard.ignore) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let ignore = false;

    async function load() {
      await loadReferenceData({ ignore });
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
    navigate('/app/work/table', {
      state: {
        from: `${location.pathname}${location.search || ''}`,
        label: 'Reference',
      },
    });
  }

  const groupTableRows = useMemo(() => groups, [groups]);
  const userTableRows = useMemo(() => users, [users]);

  async function handleAppendCsv(target, file) {
    if (!file) {
      return;
    }

    setUploadMessage('');
    setError('');
    setUploadingTarget(target);

    try {
      const parsed = parseCsvText(await file.text());
      if (!parsed.rows.length) {
        throw new Error('The CSV did not contain any data rows.');
      }

      if (target === 'groups') {
        const payload = mapGroupRows(parsed.rows, parsed.columns);
        if (!payload.length) {
          throw new Error('No valid group ids were found in the CSV.');
        }
        await upsertReferenceGroups(payload);
        await loadReferenceData();
        setUploadMessage(`Appended ${payload.length} group row${payload.length === 1 ? '' : 's'} by id. Existing rows were preserved.`);
      } else {
        const payload = mapUserRows(parsed.rows, parsed.columns);
        if (!payload.length) {
          throw new Error('No valid user ids were found in the CSV.');
        }
        await upsertReferenceUsers(payload);
        await loadReferenceData();
        setUploadMessage(`Appended ${payload.length} user row${payload.length === 1 ? '' : 's'} by id. Existing rows were preserved.`);
      }
    } catch (requestError) {
      setError(requestError.message || 'CSV append failed.');
    } finally {
      setUploadingTarget('');
      if (target === 'groups' && groupsInputRef.current) {
        groupsInputRef.current.value = '';
      }
      if (target === 'users' && usersInputRef.current) {
        usersInputRef.current.value = '';
      }
    }
  }

  return (
    <section className="module">
      <SectionHeader
        tag="Reference"
        title="Reference Data"
        description="Backend-backed master data for groups and users. These support tables are permanent; the generic Work/Table view is only a temporary session cache."
      />

      {uploadMessage ? <p className="status-text">{uploadMessage}</p> : null}

      <div className="module__grid reference-grid">
        <Card className="reference-card">
          <CardHeader
            eyebrow="Groups"
            title="Groups"
            description="Permanent backend-backed support table. Append CSV rows by id without removing existing records."
            action={
              <>
                <input
                  ref={groupsInputRef}
                  accept=".csv,text/csv"
                  className="ticket-toolbar__file-input"
                  onChange={(event) => void handleAppendCsv('groups', event.target.files?.[0] || null)}
                  type="file"
                />
                <button
                  type="button"
                  className="compact-toggle"
                  onClick={() => groupsInputRef.current?.click()}
                  disabled={uploadingTarget === 'groups'}
                >
                  <Upload size={14} />
                  {uploadingTarget === 'groups' ? 'Appending…' : 'Append CSV'}
                </button>
                <button
                  type="button"
                  className="compact-toggle"
                  onClick={() =>
                    openCachedTable({
                      fileName: 'Reference Groups',
                      rows: groupTableRows,
                      columns: ['id', 'name', 'description', 'tags']
                    })
                  }
                  disabled={!groupTableRows.length}
                >
                  Open Table
                </button>
              </>
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
                    <th>Description</th>
                    <th>Tags</th>
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
                      <td>
                        <span className="data-table__cell-content" title={g.description}>
                          {g.description || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="data-table__cell-content" title={g.tags}>
                          {g.tags || '—'}
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
            description="Permanent backend-backed support table. Append CSV rows by id without removing existing records."
            action={
              <>
                <input
                  ref={usersInputRef}
                  accept=".csv,text/csv"
                  className="ticket-toolbar__file-input"
                  onChange={(event) => void handleAppendCsv('users', event.target.files?.[0] || null)}
                  type="file"
                />
                <button
                  type="button"
                  className="compact-toggle"
                  onClick={() => usersInputRef.current?.click()}
                  disabled={uploadingTarget === 'users'}
                >
                  <Upload size={14} />
                  {uploadingTarget === 'users' ? 'Appending…' : 'Append CSV'}
                </button>
                <button
                  type="button"
                  className="compact-toggle"
                  onClick={() =>
                    openCachedTable({ fileName: 'Reference Users', rows: userTableRows, columns: ['id', 'name', 'email'] })
                  }
                  disabled={!userTableRows.length}
                >
                  Open Table
                </button>
              </>
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
