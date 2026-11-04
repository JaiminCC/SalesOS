import { ApiException } from './api.exception';

export async function runBatch(ids: string[], run: (id: string) => Promise<unknown>) {
  if (ids.length < 1 || ids.length > 50) throw new ApiException(400, 'VALIDATION_ERROR', 'Select between 1 and 50 records');
  if (new Set(ids).size !== ids.length) throw new ApiException(400, 'VALIDATION_ERROR', 'Duplicate identifiers are not allowed');
  const results = [];
  for (const id of ids) {
    try {
      await run(id);
      results.push({ id, ok: true as const });
    } catch (error) {
      const body = error instanceof ApiException ? error.getResponse() : null;
      const record = body && typeof body === 'object' ? (body as { code?: string; message?: string }) : null;
      results.push({
        id,
        ok: false as const,
        code: record?.code ?? 'ERROR',
        message: record?.message ?? 'The record could not be changed',
      });
    }
  }
  return { results };
}
