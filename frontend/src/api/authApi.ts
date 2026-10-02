export interface User {
  id: string;
  email: string;
  role: string;
  isTerminal: boolean;
  confirmed: boolean;
  phone?: string;
  phoneVerified?: boolean;
  fio?: string;
  branchId?: string;
}

export interface UserPage {
  items: User[];
  total: number;
  counts: Record<'all' | 'employee' | 'opc_chief' | 'client' | 'terminal', number>;
  limit: number;
  offset: number;
}

export interface AuthError {
  code: string;
  message: string;
  status: number;
}

class ApiAuthError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

export function getApiBaseUrl(): string {
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code || code;
        msg = data.error.message || msg;
      }
    } catch {}
    throw new ApiAuthError(code, msg, res.status);
  }

  if (res.status === 204) return null as T;
  return await res.json() as T;
}

export async function login(email: string, password: string): Promise<void> {
  await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export interface RegisterResponse extends User {
  requiresConfirmation?: boolean;
  message?: string;
}

export async function register(email: string, password: string): Promise<RegisterResponse> {
  return await request<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function confirmEmailCode(email: string, code: string): Promise<{ status: string; user: User }> {
  return await request<{ status: string; user: User }>('/auth/confirm-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

export async function resendEmailCode(email: string): Promise<{ status: string; message: string }> {
  return await request<{ status: string; message: string }>('/auth/resend-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<User | null> {
  try {
    const user = await request<User>('/auth/me', { method: 'GET' });
    if (user && typeof localStorage !== 'undefined') {
      const savedFio = localStorage.getItem('user_fio:' + (user.id || user.email)) || localStorage.getItem('user_fio:' + user.email);
      if (savedFio) user.fio = savedFio;
      const savedBranch = localStorage.getItem(`operator_branch:${user.id}`) || localStorage.getItem(`operator_branch:${user.email}`);
      if (!user.branchId && savedBranch) user.branchId = savedBranch;
    }
    return user;
  } catch (error) {
    if ((error instanceof ApiAuthError && error.status === 401) || (error as { status?: number })?.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function listUsers(params: { page?: number; limit?: number; search?: string; role?: string } = {}): Promise<UserPage> {
  const limit = params.limit ?? 25;
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(((params.page ?? 1) - 1) * limit),
  });
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.role && params.role !== 'ALL') query.set('role', params.role);
  const data = await request<UserPage>(`/admin/users?${query}`, { method: 'GET' });
  if (typeof localStorage !== 'undefined') {
    data.items = data.items.map(u => ({
      ...u,
      fio: u.fio || localStorage.getItem(`user_fio:${u.id}`) || localStorage.getItem(`user_fio:${u.email}`) || undefined,
      branchId: u.branchId || localStorage.getItem(`operator_branch:${u.id}`) || localStorage.getItem(`operator_branch:${u.email}`) || undefined
    }));
  }
  return data;
}

export async function changeUserRole(userId: string, role: string): Promise<void> {
  await request(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function changeUserBranch(userId: string, branchId: string): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`operator_branch:${userId}`, branchId);
  }
  try {
    await request(`/admin/users/${encodeURIComponent(userId)}/branch`, {
      method: 'PUT',
      body: JSON.stringify({ branchId }),
    });
  } catch {
    // If backend endpoint is not yet supported, local storage persistence is active
  }
}

export async function sendPhoneCode(phone: string): Promise<{ status: string; phone: string; expiresIn: number }> {
  return await request('/auth/profile/phone/send-code', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export async function verifyPhoneCode(code: string): Promise<User> {
  return await request<User>('/auth/profile/phone/verify-code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

