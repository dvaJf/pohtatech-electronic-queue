import { QueuePolicy, UpdateQueuePolicyRequest, AdminApiError, AdminWindow } from './types';
import { Branch, BranchListResponse } from '../operator/types';

export async function getOverview(branchId: string): Promise<import('./types').AdminBranchOverview> {
  const response = await fetch(`${getApiBaseUrl()}/admin/branches/${encodeURIComponent(branchId)}/overview`, { credentials: 'include', headers: { Accept: 'application/json' } });
  return handleResponse(response);
}

export async function listAnomalies(branchId: string, page = 1, limit = 25): Promise<import('./types').AnomalyPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
  const response = await fetch(`${getApiBaseUrl()}/admin/branches/${encodeURIComponent(branchId)}/anomalies?${query}`, {
    credentials: 'include', headers: { Accept: 'application/json' },
  });
  return handleResponse(response);
}

function getApiBaseUrl(): string {
  let envUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE_URL : undefined;

  if (typeof window !== 'undefined' && window.location) {
    const isLocalhostHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (envUrl && typeof envUrl === 'string') {
      const isEnvLocalhost = envUrl.includes('localhost') || envUrl.includes('127.0.0.1');
      if (isEnvLocalhost && !isLocalhostHost) {
        envUrl = undefined;
      }
    }
  }

  if (!envUrl || typeof envUrl !== 'string' || envUrl.trim() === '' || envUrl === '/') {
    return '/api/v1';
  }

  const clean = envUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/api/v1')) {
    return clean;
  }
  if (clean.endsWith('/api')) {
    return `${clean}/v1`;
  }
  return `${clean}/api/v1`;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorCode = 'INTERNAL_ERROR';
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let requestId: string | undefined;

    try {
      const data = await response.json();
      if (data?.error) {
        errorCode = data.error.code || errorCode;
        errorMessage = data.error.message || errorMessage;
        requestId = data.error.requestId;
      }
    } catch {
      // non-JSON
    }

    throw new AdminApiError(errorCode, errorMessage, response.status, requestId);
  }

  return (await response.json()) as T;
}

export async function getQueuePolicy(branchId: string): Promise<QueuePolicy> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/branches/${encodeURIComponent(branchId)}/queue-policy`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  return await handleResponse<QueuePolicy>(res);
}

export async function updateQueuePolicy(
  branchId: string,
  req: UpdateQueuePolicyRequest
): Promise<QueuePolicy> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/branches/${encodeURIComponent(branchId)}/queue-policy`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });

  return await handleResponse<QueuePolicy>(res);
}

export async function listBranches(): Promise<Branch[]> {
  const res = await fetch(`${getApiBaseUrl()}/branches`, {
    headers: { Accept: 'application/json' },
  });
  return (await handleResponse<BranchListResponse>(res)).items;
}

export type WindowStatusUpdate = 'OPEN' | 'CLOSED' | 'CLOSING';

// Persist window shift status (OPEN/CLOSED/CLOSING). Without persistence the next
// overview poll reverts the operator's change.
export async function changeWindowStatus(windowId: string, status: WindowStatusUpdate): Promise<AdminWindow> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/windows/${encodeURIComponent(windowId)}/status`, {
    method: 'PUT',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return await handleResponse<AdminWindow>(res);
}

// Replace the set of services a window is allowed to serve (window_services).
export async function updateWindowServices(windowId: string, serviceIds: string[]): Promise<AdminWindow> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/windows/${encodeURIComponent(windowId)}/services`, {
    method: 'PUT',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceIds }),
  });
  return await handleResponse<AdminWindow>(res);
}

export type ShiftClosureResult = {
  branchId: string;
  cancelledTicketsCount: number;
  windowsClosingCount: number;
  windowsClosedCount: number;
};

export async function closeShift(branchId: string): Promise<ShiftClosureResult> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/branches/${encodeURIComponent(branchId)}/close-shift`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return await handleResponse<ShiftClosureResult>(res);
}

export async function updateBranchSchedule(branchId: string, workHours: string): Promise<Branch> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/branches/${encodeURIComponent(branchId)}/schedule`, {
    method: 'PUT',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ workHours }),
  });
  return await handleResponse<Branch>(res);
}

export async function createWindow(branchId: string): Promise<AdminWindow> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/branches/${encodeURIComponent(branchId)}/windows`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return await handleResponse<AdminWindow>(res);
}

export async function deleteWindow(windowId: string): Promise<void> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/admin/windows/${encodeURIComponent(windowId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    await handleResponse(res);
  }
}

export interface AdminReviewItem {
  id: string;
  ticketId: string | null;
  branchId: string;
  branchName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface AdminReviewSummary {
  averageRating: number | null;
  totalReviews: number;
  distribution: Record<string, number>;
}

export interface AdminReviewsResult {
  items: AdminReviewItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: AdminReviewSummary;
}

export interface GetAdminReviewsParams {
  branchId?: string;
  rating?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export async function getAdminReviews(params: GetAdminReviewsParams = {}): Promise<AdminReviewsResult> {
  const base = getApiBaseUrl();
  const searchParams = new URLSearchParams();
  if (params.branchId) searchParams.set('branchId', params.branchId);
  if (params.rating) searchParams.set('rating', String(params.rating));
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const qs = searchParams.toString();
  const url = `${base}/admin/reviews${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      return await res.json();
    }
    if (res.status !== 404) {
      return await handleResponse<AdminReviewsResult>(res);
    }
  } catch (err: any) {
    if (err?.status && err.status !== 404 && !err.message?.includes('404')) {
      throw err;
    }
  }

  return await fallbackGetAdminReviews(params);
}

async function fallbackGetAdminReviews(params: GetAdminReviewsParams): Promise<AdminReviewsResult> {
  let allItems: AdminReviewItem[] = [];
  let summary: AdminReviewSummary = {
    averageRating: null,
    totalReviews: 0,
    distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
  };

  const branchId = params.branchId;
  if (branchId) {
    try {
      const ov = await getOverview(branchId);
      if (ov?.quality) {
        summary = {
          averageRating: ov.quality.ratingAverage,
          totalReviews: ov.quality.ratingCount,
          distribution: {
            '1': ov.quality.distribution?.['1'] || 0,
            '2': ov.quality.distribution?.['2'] || 0,
            '3': ov.quality.distribution?.['3'] || 0,
            '4': ov.quality.distribution?.['4'] || 0,
            '5': ov.quality.distribution?.['5'] || 0,
          },
        };
        if (Array.isArray(ov.quality.recentFeedback)) {
          allItems = ov.quality.recentFeedback.map((f, idx) => ({
            id: `ov-${idx}-${f.createdAt}`,
            ticketId: null,
            branchId,
            branchName: ov.branchName || 'Отделение',
            rating: f.rating,
            comment: f.comment,
            createdAt: f.createdAt,
          }));
        }
      }
    } catch {
      // Continue to try public reviews if overview fails
    }

    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/branches/${encodeURIComponent(branchId)}/reviews`);
      if (res.ok) {
        const body = await res.json();
        const branchReviews = Array.isArray(body?.items) ? body.items : [];
        if (branchReviews.length > 0 && allItems.length === 0) {
          allItems = branchReviews.map((br: any, idx: number) => ({
            id: br.id || `br-${idx}`,
            ticketId: null,
            branchId,
            branchName: 'Отделение',
            rating: br.rating,
            comment: br.comment,
            createdAt: br.createdAt,
          }));
        }
      }
    } catch {
      // Ignore
    }
  } else {
    try {
      const branches = await listBranches();
      const overviewPromises = branches.slice(0, 15).map(async (b) => {
        try {
          const ov = await getOverview(b.id);
          return { branch: b, overview: ov };
        } catch {
          return null;
        }
      });
      const results = await Promise.all(overviewPromises);
      let totalRatingSum = 0;
      let totalRatingCount = 0;
      const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

      for (const res of results) {
        if (!res?.overview?.quality) continue;
        const q = res.overview.quality;
        if (q.ratingAverage !== null && q.ratingCount > 0) {
          totalRatingSum += q.ratingAverage * q.ratingCount;
          totalRatingCount += q.ratingCount;
        }
        for (const star of ['1', '2', '3', '4', '5'] as const) {
          dist[star] = (dist[star] || 0) + (q.distribution?.[star] || 0);
        }
        if (Array.isArray(q.recentFeedback)) {
          for (const [idx, f] of q.recentFeedback.entries()) {
            allItems.push({
              id: `${res.branch.id}-${idx}-${f.createdAt}`,
              ticketId: null,
              branchId: res.branch.id,
              branchName: res.branch.name,
              rating: f.rating,
              comment: f.comment,
              createdAt: f.createdAt,
            });
          }
        }
      }

      summary = {
        averageRating: totalRatingCount > 0 ? Math.round((totalRatingSum / totalRatingCount) * 10) / 10 : null,
        totalReviews: totalRatingCount,
        distribution: dist,
      };
    } catch {
      // Ignore
    }
  }

  if (allItems.length > 0 && summary.totalReviews === 0) {
    let sum = 0;
    const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const it of allItems) {
      sum += it.rating;
      const s = String(it.rating);
      dist[s] = (dist[s] || 0) + 1;
    }
    summary = {
      averageRating: Math.round((sum / allItems.length) * 10) / 10,
      totalReviews: allItems.length,
      distribution: dist,
    };
  }

  let filtered = allItems;
  if (params.rating) {
    filtered = filtered.filter((i) => i.rating === params.rating);
  }

  const sort = params.sort || 'newest';
  filtered.sort((a, b) => {
    if (sort === 'oldest') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    if (sort === 'highest') {
      return b.rating - a.rating;
    }
    if (sort === 'lowest') {
      return a.rating - b.rating;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const page = Math.max(1, params.page || 1);
  const pageSize = Math.max(1, params.pageSize || 10);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: paginated,
    total,
    page,
    pageSize,
    totalPages,
    summary,
  };
}



