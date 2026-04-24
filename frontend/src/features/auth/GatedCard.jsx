import { Lock } from 'lucide-react';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';

function openAuthModal() {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.assign('/login');
}

export function GatedCard({
  title = 'Sign in required',
  message = 'Sign in to view this module',
  actionLabel = 'Authenticate',
  showAction = true,
  className = '',
}) {
  return (
    <Card className={`gated-card ${className}`.trim()}>
      <CardHeader
        eyebrow="Access Control"
        title={title}
        description={message}
      />
      <div className="gated-card__body">
        <div className="gated-card__icon" aria-hidden="true">
          <Lock size={18} />
        </div>
        {showAction ? (
          <Button type="button" onClick={openAuthModal}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export default GatedCard;
