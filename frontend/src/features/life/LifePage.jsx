import { CalendarClock, Heart, Home, NotebookTabs } from 'lucide-react';
import { Card, CardHeader } from '../../app/ui/Card';
import { SectionHeader } from '../../app/ui/SectionHeader';

const systems = [
  { label: 'Calendar and commitments', icon: CalendarClock },
  { label: 'Health and routines', icon: Heart },
  { label: 'Home and family logistics', icon: Home }
];

export function LifePage() {
  return (
    <section className="module">
      <SectionHeader
        tag="/life"
        title="Life"
        description="Personal systems stay visible here without bleeding into work or service operations."
      />

      <div className="card-grid">
        <Card tone="emerald">
          <CardHeader
            eyebrow="Core loops"
            title="Structured personal operations"
            description="A calm surface for the recurring systems that keep the rest of the stack from leaking into everyday life."
          />
          <ul className="icon-list">
            {systems.map((system) => (
              <li key={system.label}>
                <span className="icon-badge">
                  <system.icon size={16} />
                </span>
                <span>{system.label}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            eyebrow="Intent"
            title="Deliberately small"
            description="Keep this module constrained and useful so it grows like a system of record, not a dumping ground."
          />
          <div className="signal-panel">
            <div className="signal-panel__item">
              <NotebookTabs size={18} />
              <div>
                <strong>Private by default</strong>
                <p>Household, routines, and commitments stay in their own lane.</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
