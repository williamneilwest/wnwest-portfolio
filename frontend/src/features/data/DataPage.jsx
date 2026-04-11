import { NavLink } from 'react-router-dom';
import { SectionHeader } from '../../app/ui/SectionHeader';

function ModuleCard({ to, title, description }) {
  return (
    <NavLink to={to} className="ui-card module">
      <div className="ui-card__header">
        <div>
          <span className="ui-eyebrow">Module</span>
          <h3 className="ui-card__title">{title}</h3>
          <p className="ui-card__description">{description}</p>
        </div>
      </div>
      <div>
        <span className="compact-toggle" aria-hidden="true">Open</span>
      </div>
    </NavLink>
  );
}

export function DataPage() {
  return (
    <section className="module">
      <SectionHeader tag="Data" title="Data" description="Uploads and tabular viewers" />

      <div className="module__grid">
        <ModuleCard
          to="/app/reference"
          title="Source Data"
          description="Browse master tables for groups, users, and endpoint registry records"
        />
        <ModuleCard to="/app/uploads" title="Uploads" description="Ingest files and email attachments" />
        <ModuleCard to="/app/work/table" title="Table Viewer" description="Explore CSV data in a table" />
      </div>
    </section>
  );
}

export default DataPage;
