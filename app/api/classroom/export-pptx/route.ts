import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { isValidClassroomId, readClassroom } from '@/lib/server/classroom-storage';
import { buildPptxBlob } from '@/lib/export/build-pptx-blob';
import type { Scene, SlideContent } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomExportPptx');

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VIEWPORT_SIZE = 960;
const VIEWPORT_RATIO = 9 / 16; // 16:9 → height/width
const RATIO_PX_2_INCH = 96;
const RATIO_PX_2_PT = 96 / 72;

/**
 * 服务端导出课堂 PPTX，供 EduMind 入库。
 * GET /api/classroom/export-pptx?id=
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing id parameter');
  }
  if (!isValidClassroomId(id)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid classroom id');
  }

  try {
    const classroom = await readClassroom(id);
    if (!classroom?.scenes?.length) {
      return apiError('INVALID_REQUEST', 404, 'Classroom not found');
    }

    const scenes = classroom.scenes as Scene[];
    const slideScenes = scenes.filter((s) => s.content?.type === 'slide');
    const slides = slideScenes.map((s) => (s.content as SlideContent).canvas);

    if (!slides.length) {
      return apiError('INVALID_REQUEST', 422, 'No slide scenes to export');
    }

    const blob = await buildPptxBlob(
      slides,
      slideScenes,
      VIEWPORT_RATIO,
      VIEWPORT_SIZE,
      RATIO_PX_2_INCH,
      RATIO_PX_2_PT,
    );
    const buf = Buffer.from(await blob.arrayBuffer());
    const fileName = `${classroom.stage?.name || id}.pptx`.replace(/[\\/:*?"<>|]+/g, '_');

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    log.error(`export-pptx failed [id=${id}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to export classroom PPTX',
      error instanceof Error ? error.message : String(error),
    );
  }
}
