import { useEffect, useState } from 'react';
import { ChevronDown, Eye, FileSpreadsheet } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { analyzeDocument, getUploads } from '../../app/services/api';
import { buildDocumentViewHref, isCsvFile } from '../../app/utils/documentFiles';
import { formatDataFileName } from '../../app/utils/fileDisplay';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';

function formatUploadTimestamp(value) {
  if (!value) {
    return 'Time unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Time unavailable';
  }

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatUploadSource(value) {
  return String(value || '').trim().toLowerCase() === 'email' ? 'Email upload' : 'Manual upload';
}

export function UploadsPage() {
  const location = useLocation();
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    getUploads()
      .then((data) => {
        if (isMounted) {
          setFiles(Array.isArray(data) ? data : []);
        }
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(requestError.message || 'Uploads could not be loaded.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="module">
      <Card className="analysis-grid__wide">
        <CardHeader
          eyebrow="Uploads"
          title="Stored files"
          description="Attachments delivered to uploads@mail.westos.dev appear here."
        />

        {error ? <p className="status-text status-text--error">{error}</p> : null}
        {message ? <p className="status-text">{message}</p> : null}

        {files.length ? (
          <div className="stack-list">
            {files.map((file) => {
              const csvFile = isCsvFile(file.filename, file.mimeType);
              const primaryHref = csvFile
                ? `/app/work/table?url=${encodeURIComponent(file.url)}&fileName=${encodeURIComponent(file.filename)}`
                : buildDocumentViewHref({
                    url: file.url,
                    fileName: file.filename,
                    mimeType: file.mimeType,
                    title: 'Uploads',
                    backTo: '/app/uploads',
                  });

              const primaryLabel = csvFile ? 'View Table' : 'Open';
              const tableHref = `/app/work/table?url=${encodeURIComponent(file.url)}&fileName=${encodeURIComponent(file.filename)}&modifiedAt=${encodeURIComponent(file.modifiedAt || '')}`;
              const routeState = {
                from: `${location.pathname}${location.search || ''}`,
                label: 'Uploads',
              };

              return (
              <div className="stack-row" key={file.filename}>
                <span className="stack-row__label">
                  <FileSpreadsheet size={16} />
                  <span>
                    <strong>{formatDataFileName(file.filename)}</strong>
                    <small>{formatUploadSource(file.source)} · {formatUploadTimestamp(file.modifiedAt)}</small>
                  </span>
                </span>
                <div className="stack-row__actions">
                  <Link
                    className="compact-toggle"
                    to={primaryHref}
                    state={routeState}
                  >
                    <Eye size={14} />
                    {primaryLabel}
                  </Link>
                  <a className="compact-toggle" download={file.filename} href={file.url}>
                    Download
                  </a>
                  <Link
                    className="compact-toggle"
                    to={tableHref}
                    state={routeState}
                  >
                    Open in Table
                  </Link>
                  <button
                    type="button"
                    className="compact-toggle"
                    onClick={async () => {
                      setError('');
                      setMessage('');

                      try {
                        await analyzeDocument(file.path);
                        setMessage(`${formatDataFileName(file.filename)} analyzed.`);
                      } catch (requestError) {
                        setError(requestError.message || 'Document analysis failed.');
                      }
                    }}
                  >
                    Analyze
                  </button>
                </div>
                <details className="upload-row-menu">
                  <summary className="compact-toggle upload-row-menu__toggle">
                    Actions
                    <ChevronDown className="compact-toggle__icon" size={14} />
                  </summary>
                  <div className="upload-row-menu__panel">
                    <Link
                      className="upload-row-menu__action"
                      to={primaryHref}
                      state={routeState}
                    >
                      <Eye size={14} />
                      {primaryLabel}
                    </Link>
                    <a className="upload-row-menu__action" download={file.filename} href={file.url}>
                      Download
                    </a>
                    <Link
                      className="upload-row-menu__action"
                      to={tableHref}
                      state={routeState}
                    >
                      Open in Table
                    </Link>
                    <button
                      type="button"
                      className="upload-row-menu__action"
                      onClick={async () => {
                        setError('');
                        setMessage('');

                        try {
                          await analyzeDocument(file.path);
                          setMessage(`${formatDataFileName(file.filename)} analyzed.`);
                        } catch (requestError) {
                          setError(requestError.message || 'Document analysis failed.');
                        }
                      }}
                    >
                      Analyze
                    </button>
                  </div>
                </details>
              </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No uploads yet"
            description="Incoming attachments will show up here once delivered."
          />
        )}
      </Card>
    </section>
  );
}
