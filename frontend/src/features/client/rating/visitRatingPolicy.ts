export type VisitRatingTicketStatus = 'COMPLETED' | 'WAITING' | 'CALLED' | 'SERVING' | 'SCHEDULED' | 'CANCELLED' | 'NO_SHOW';

export function shouldOfferVisitRating(
  status: VisitRatingTicketStatus,
  ticketId: string,
  reviewedTicketIds: string[],
  dismissedTicketIds: string[],
): boolean {
  return status === 'COMPLETED' && Boolean(ticketId)
    && !reviewedTicketIds.includes(ticketId)
    && !dismissedTicketIds.includes(ticketId);
}
