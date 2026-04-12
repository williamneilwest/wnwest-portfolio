import { useEffect, useState } from 'react';
import { ChevronDown, Eye, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getUploads } from '../../app/services/api';
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
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

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
          title="Stored CSV files"
          description="CSV attachments delivered to upload@mail.westos.dev appear here."
        />

        {error ? <p className="status-text status-text--error">{error}</p> : null}

        {files.length ? (
          <div className="stack-list">
            {files.map((file) => (
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
                    to={`/app/work/table?url=${encodeURIComponent(file.url)}&fileName=${encodeURIComponent(file.filename)}`}
                  >
                    <Eye size={14} />
                    View
                  </Link>
                  <a className="compact-toggle" download={file.filename} href={file.url}>
                    Download
                  </a>
                </div>
                <details className="upload-row-menu">
                  <summary className="compact-toggle upload-row-menu__toggle">
                    Actions
                    <ChevronDown className="compact-toggle__icon" size={14} />
                  </summary>
                  <div className="upload-row-menu__panel">
                    <Link
                      className="upload-row-menu__action"
                      to={`/app/work/table?url=${encodeURIComponent(file.url)}&fileName=${encodeURIComponent(file.filename)}`}
                    >
                      <Eye size={14} />
                      View
                    </Link>
                    <a className="upload-row-menu__action" download={file.filename} href={file.url}>
                      Download
                    </a>
                  </div>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No CSV uploads yet"
            description="Incoming SendGrid CSV attachments will show up here once delivered."
          />
        )}
      </Card>
    </section>
  );
}
