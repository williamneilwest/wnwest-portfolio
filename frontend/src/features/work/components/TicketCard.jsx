import { ArrowRight, Clock3, Lightbulb, Sparkles, Tag, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../../app/ui/Card';
import {
  getTicketAssignee,
  getTicketId,
  getTicketLastUpdatedLabel,
  getTicketStatus,
  getTicketTitle,
} from '../utils/aiAnalysis';

export function TicketCard({ ticket, columns, matchedRules = [], onOpen, navigationState = null }) {
  const ticketId = getTicketId(ticket, columns);
  const hasAiAnalysis = Boolean(ticket?.ai_analysis?.result);
  const canOpenTicketRoute = ticketId && ticketId !== 'Untitled ticket';
  const safeRules = (matchedRules || []).filter((rule) => rule && typeof rule === 'object');
  const hasTaggedRule = safeRules.some((rule) => {
    const ruleId = String(rule?.id || '').toLowerCase();
    const hasTagAssociations = Array.isArray(rule?.associatedGroupTags) && rule.associatedGroupTags.length > 0;
    return ruleId === 'responder_group' || ruleId.startsWith('kb_tag_') || hasTagAssociations;
  });
  const visibleRules = safeRules.filter((rule) => {
    const ruleId = String(rule?.id || '').toLowerCase();
    const hasTagAssociations = Array.isArray(rule?.associatedGroupTags) && rule.associatedGroupTags.length > 0;
    const isTagRule = ruleId === 'responder_group' || ruleId.startsWith('kb_tag_') || hasTagAssociations;
    return !isTagRule;
  });
  const primaryRule = visibleRules[0] || null;
  const suggestionTooltip = visibleRules.map((rule) => String(rule?.suggestion || '')).filter(Boolean).join('\n');
  const cardClassName = ['ticket-card', primaryRule?.highlightClass].filter(Boolean).join(' ');
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
        {hasTaggedRule ? (
          <span className="ticket-card__tag-chip">
            <Tag size={13} />
            Tagged
          </span>
        ) : null}
        {visibleRules.length ? (
          <span
            className="ticket-card__rule-chip"
            data-tooltip={suggestionTooltip}
            title={suggestionTooltip}
          >
            <Lightbulb size={14} />
            {visibleRules.length === 1 ? 'Suggestion' : `${visibleRules.length} suggestions`}
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

      {visibleRules.length ? (
        <div className="ticket-card__suggestions">
          {visibleRules.map((rule, index) => (
            <p className="ticket-card__suggestion" key={rule.id || `rule-${index}`}>
              {rule?.suggestion || 'Suggestion available'}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );

  if (canOpenTicketRoute) {
    return (
      <Card className={cardClassName}>
        <Link className="ticket-card-link" state={navigationState || undefined} to={`/tickets/${encodeURIComponent(ticketId)}`}>
          {content}
        </Link>
      </Card>
    );
  }

  return (
    <Card className={cardClassName}>
      <button className="ticket-card-link ticket-card-link--button" onClick={() => onOpen?.(ticket)} type="button">
        {content}
      </button>
    </Card>
  );
}
