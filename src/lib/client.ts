import type { ApiErrorBody } from './types';

export type ApiFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
};

export type ApiSuccess<T> = {
  ok: true;
  status: number;
  data: T;
};

export type ClientApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ClientApiResult<T>> {
  try {
    const response = await fetch(input, {
      cache: 'no-store',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const body = payload as Partial<ApiErrorBody> | null;
      return {
        ok: false,
        status: response.status,
        error:
          body && typeof body.error === 'string'
            ? body.error
            : `请求失败（HTTP ${response.status}）`,
        code: body?.code,
      };
    }

    return { ok: true, status: response.status, data: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : '网络连接失败',
      code: 'NETWORK_ERROR',
    };
  }
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}
