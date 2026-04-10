import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { getUploads } from '../../app/services/api';
import { Card, CardHeader } from '../../app/ui/Card';
import { EmptyState } from '../../app/ui/EmptyState';

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
              <a
                className="stack-row stack-row--interactive"
                href={file.url}
                key={file.filename}
                rel="noreferrer"
                target="_blank"
              >
                <span className="stack-row__label">
                  <FileSpreadsheet size={16} />
                  <span>
                    <strong>{file.filename}</strong>
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No CSV uploads yet"
            description="Incoming Mailgun CSV attachments will show up here once delivered."
          />
        )}
      </Card>
    </section>
  );
}
