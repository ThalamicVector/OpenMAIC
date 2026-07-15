import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  fetchClassroomJsonFromUrl,
  unwrapEduMindClassroomJson,
} from '@/lib/integrations/edumind/classroom-json';

/**
 * 代理拉取 EduMind MinIO 上的课堂 JSON（服务端无 CORS 限制）。
 * GET /api/classroom/import-from-url?url=
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url?.trim()) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing url parameter');
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid url protocol');
    }
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid url');
  }

  try {
    const raw = await fetchClassroomJsonFromUrl(url);
    const classroom = unwrapEduMindClassroomJson(raw);
    if (!classroom) {
      return apiError('INVALID_REQUEST', 422, 'Unrecognized classroom JSON format');
    }
    return apiSuccess({ classroom });
  } catch (e) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to import classroom from url',
      e instanceof Error ? e.message : String(e),
    );
  }
}
