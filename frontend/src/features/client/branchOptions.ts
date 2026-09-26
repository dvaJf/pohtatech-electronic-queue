export const BOOKING_BRANCH_PREVIEW_LIMIT = 5;

export function getBookingBranchOptions<T>(branches: T[], searchQuery: string): T[] {
  if (searchQuery.trim()) return branches;
  return branches.slice(0, BOOKING_BRANCH_PREVIEW_LIMIT);
}
