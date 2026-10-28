'use client';

import { useCallback, useState } from 'react';
import type { ApiErrorBody } from '@/lib/types';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type ApiState = {
  loading: boolean;
  error: string | null;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as ApiErrorBody).error === 'string'
  ) {
    return (payload as ApiErrorBody).error;
  }
  return fallback;
}

export function useApi<T>() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  const execute = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<ApiResult<T>> => {
      setState({ loading: true, error: null });
      try {
        const response = await fetch(input, {
          cache: 'no-store',
          ...init,
          headers: {
            Accept: 'application/json',
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
          const message = errorMessage(payload, `请求失败（HTTP ${response.status}）`);
          setState({ loading: false, error: message });
          return { ok: false, error: message };
        }

        setState({ loading: false, error: null });
        return { ok: true, data: payload as T };
      } catch (error) {
        const message = error instanceof Error ? error.message : '网络连接失败';
        setState({ loading: false, error: message });
        return { ok: false, error: message };
      }
    },
    [],
  );

  return { ...state, execute };
}
