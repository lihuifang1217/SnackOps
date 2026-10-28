import 'server-only';

import { ZodError, type z } from 'zod';
import { AppError } from './errors';
import { StoreError } from './store';

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      error.status,
    );
  }

  if (error instanceof ZodError) {
    return jsonResponse(
      {
        error: '请求参数未通过校验',
        code: 'VALIDATION_FAILED',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }

  if (error instanceof StoreError) {
    const status = error.code === 'NOT_FOUND' ? 404 : 500;
    return jsonResponse({ error: error.message, code: error.code }, status);
  }

  console.error('[api] 未处理的错误', error);
  return jsonResponse({ error: '服务端处理失败', code: 'INTERNAL_ERROR' }, 500);
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', '请求体必须是有效 JSON');
  }
  return schema.parse(payload);
}

export async function readRequestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', '请求体必须是有效 JSON');
  }
}
