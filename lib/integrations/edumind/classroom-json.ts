/**
 * EduMind 集成：从外部 URL（MinIO JSON）加载课堂。
 * 与 OpenMAIC 核心逻辑隔离，升级时可单独维护/替换。
 */

export type EduMindClassroomWrapper = {
  version?: number;
  courseId?: number;
  treeNodeId?: string;
  openmaicClassroomId?: string;
  payload?: EduMindClassroomPayload;
  /** 兼容未包装的直接 classroom 快照 */
  stage?: unknown;
  scenes?: unknown[];
};

export type EduMindClassroomPayload = {
  stage?: Record<string, unknown>;
  scenes?: unknown[];
  id?: string;
  title?: string;
};

export function unwrapEduMindClassroomJson(
  raw: EduMindClassroomWrapper,
): { stage: Record<string, unknown>; scenes: unknown[] } | null {
  if (raw.payload?.stage && Array.isArray(raw.payload.scenes)) {
    return { stage: raw.payload.stage, scenes: raw.payload.scenes };
  }
  if (raw.stage && Array.isArray(raw.scenes)) {
    return { stage: raw.stage as Record<string, unknown>, scenes: raw.scenes };
  }
  if (
    raw.payload &&
    typeof raw.payload === 'object' &&
    'stage' in raw.payload &&
    'scenes' in raw.payload
  ) {
    const p = raw.payload as EduMindClassroomPayload;
    if (p.stage && Array.isArray(p.scenes)) {
      return { stage: p.stage, scenes: p.scenes };
    }
  }
  // OpenMAIC GET /api/classroom 格式：{ classroom: { stage, scenes } }
  const nested = raw as unknown as { classroom?: EduMindClassroomPayload };
  if (nested.classroom?.stage && Array.isArray(nested.classroom.scenes)) {
    return { stage: nested.classroom.stage, scenes: nested.classroom.scenes };
  }
  return null;
}

/** 服务端 fetch 外部 JSON（绕过浏览器 CORS） */
export async function fetchClassroomJsonFromUrl(
  jsonUrl: string,
): Promise<EduMindClassroomWrapper> {
  const res = await fetch(jsonUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch classroom JSON: HTTP ${res.status}`);
  }
  return (await res.json()) as EduMindClassroomWrapper;
}
