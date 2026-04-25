import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function WorkCard({ item, onOpen, featured = false }) {
  const className = [
    'ui-card',
    'work-domain-card',
    'work-domain-card--nav',
    featured ? 'work-domain-card--featured' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link
      className={className}
      to={item.href}
      onClick={() => onOpen({ title: item.title, href: item.href })}
      state={{ from: '/app/work', label: 'Work Hub' }}
    >
      <div className="work-domain-card__head">
        <span className="work-domain-card__icon" aria-hidden="true">
          <item.icon size={16} />
        </span>
        <div className="work-domain-card__copy">
          <div className="work-domain-card__title-row">
            <h3>{item.title}</h3>
            <ArrowRight className="work-domain-card__arrow" size={14} aria-hidden="true" />
          </div>
        </div>
      </div>
    </Link>
  );
}
