import { ArrowRight, Clock3, Sparkles, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../../app/ui/Card';
import {
  getTicketAssignee,
  getTicketId,
  getTicketLastUpdatedLabel,
  getTicketStatus,
  getTicketTitle,
} from '../utils/aiAnalysis';

export function TicketCard({ ticket, columns, onOpen }) {
  const ticketId = getTicketId(ticket, columns);
  const hasAiAnalysis = Boolean(ticket?.ai_analysis?.result);
  const canOpenTicketRoute = ticketId && ticketId !== 'Untitled ticket';
  const content = (
    <>
      <div className="ticket-card__header">
        <div>
          <span className="ui-eyebrow">{canOpenTicketRoute ? 'Ticket' : 'Row'}</span>
          <h3>{ticketId}</h3>
          <p>{getTicketTitle(ticket, columns)}</p>
        </div>
        {hasAiAnalysis ? (
          <span className="ticket-card__ai-chip">
            <Sparkles size={14} />
            AI cached
          </span>
        ) : null}
      </div>

      <div className="ticket-card__meta">
        <div className="ticket-card__meta-item">
          <UserRound size={14} />
          <span>{getTicketAssignee(ticket, columns)}</span>
        </div>
        <div className="ticket-card__meta-item">
          <Clock3 size={14} />
          <span>{getTicketLastUpdatedLabel(ticket, columns)}</span>
        </div>
      </div>

      <div className="ticket-card__footer">
        <span className="ticket-card__status">{getTicketStatus(ticket, columns)}</span>
        <span className="ticket-card__action">
          {canOpenTicketRoute ? 'Open ticket' : 'Open row'}
          <ArrowRight size={15} />
        </span>
      </div>
    </>
  );

  if (canOpenTicketRoute) {
    return (
      <Card className="ticket-card">
        <Link className="ticket-card-link" to={`/tickets/${encodeURIComponent(ticketId)}`}>
          {content}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="ticket-card">
      <button className="ticket-card-link ticket-card-link--button" onClick={() => onOpen?.(ticket)} type="button">
        {content}
      </button>
    </Card>
  );
}
