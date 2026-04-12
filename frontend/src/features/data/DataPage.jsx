import { Database, FileSpreadsheet, Upload } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { SectionHeader } from '../../app/ui/SectionHeader';

function ModuleCard({ to, title, description, icon: Icon, state }) {
  return (
    <NavLink to={to} state={state} className="ui-card data-tool-card">
      <div className="data-tool-card__top">
        <span className="data-tool-card__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <div className="data-tool-card__copy">
          <span className="ui-eyebrow">Module</span>
          <h3 className="data-tool-card__title">{title}</h3>
          <p className="data-tool-card__description">{description}</p>
        </div>
      </div>
      <div className="data-tool-card__footer">
        <span className="compact-toggle" aria-hidden="true">
          Open
        </span>
      </div>
    </NavLink>
  );
}

export function DataPage() {
  const dataSources = [
    {
      to: '/app/reference',
      title: 'Source Data',
      description: 'Browse groups, users, and endpoint registry records',
      icon: Database,
      state: { from: '/app/data', label: 'Data' },
    },
    {
      to: '/app/work/table',
      title: 'Table Viewer',
      description: 'Explore CSV datasets in a focused table workspace',
      icon: FileSpreadsheet,
      state: { from: '/app/data', label: 'Data' },
    },
  ];

  const ingestion = [
    {
      to: '/app/uploads',
      title: 'Uploads',
      description: 'Ingest files and email attachments into the workspace',
      icon: Upload,
      state: { from: '/app/data', label: 'Data' },
    },
  ];

  return (
    <section className="module">
      <SectionHeader
        tag="Data"
        title="Data"
        description="Data tools for ingestion and tabular exploration."
        actions={
          <div className="data-quick-actions">
            <Link className="compact-toggle" state={{ from: '/app/data', label: 'Data' }} to="/app/uploads">
              Upload File
            </Link>
            <Link className="compact-toggle" state={{ from: '/app/data', label: 'Data' }} to="/app/work/table">
              View Tables
            </Link>
            <Link className="compact-toggle" to="/app/console">
              Recent Activity
            </Link>
          </div>
        }
      />

      <section className="data-group">
        <header className="data-group__header">
          <strong>Data Sources</strong>
          <small>Reference and exploration tools</small>
        </header>
        <div className="data-tools-grid">
          {dataSources.map((item) => (
            <ModuleCard key={item.to} {...item} />
          ))}
        </div>
      </section>

      <section className="data-group">
        <header className="data-group__header">
          <strong>Ingestion</strong>
          <small>Bring new files into the workspace</small>
        </header>
        <div className="data-tools-grid">
          {ingestion.map((item) => (
            <ModuleCard key={item.to} {...item} />
          ))}
        </div>
      </section>
    </section>
  );
}

export default DataPage;
