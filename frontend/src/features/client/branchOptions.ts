export const BRANCH_PAGE_SIZES = [5, 10, 20, 50] as const;
export type BranchPageSize = typeof BRANCH_PAGE_SIZES[number];

export interface BranchPage<T> {
  items: T[];
  page: number;
  pageSize: BranchPageSize;
  totalItems: number;
  totalPages: number;
  from: number;
  to: number;
}

export function paginateBranches<T>(branches: T[], requestedPage: number, pageSize: BranchPageSize): BranchPage<T> {
  const totalItems = branches.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const start = (page - 1) * pageSize;
  const items = branches.slice(start, start + pageSize);
  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages,
    from: totalItems === 0 ? 0 : start + 1,
    to: start + items.length,
  };
}

export interface BranchLandmarkSource {
  metro: string;
  metroColor: string;
  landmarkType?: 'metro' | 'landmark';
}

export function getLandmarkPresentation(location?: BranchLandmarkSource | null) {
  if (!location?.metro) return null;
  const isMetro = location.landmarkType !== 'landmark';
  return {
    label: location.metro,
    isMetro,
    color: isMetro ? location.metroColor : undefined,
  };
}
