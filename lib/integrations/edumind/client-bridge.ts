'use client';

import type { Scene } from '@/lib/types/stage';
import { migrateScene } from '@/lib/edit/slide-schema';
import {
  unwrapEduMindClassroomJson,
  type EduMindClassroomWrapper,
} from '@/lib/integrations/edumind/classroom-json';
import { createLogger } from '@/lib/logger';

const log = createLogger('EduMindIntegration');

/**
 * 当 IndexedDB / 服务端均无数据时，从 jsonUrl 加载（EduMind MinIO）。
 */
export async function loadClassroomFromJsonUrl(
  jsonUrl: string,
): Promise<{ stage: Record<string, unknown>; scenes: Scene[] } | null> {
  try {
    const proxyUrl = `/api/classroom/import-from-url?url=${encodeURIComponent(jsonUrl)}`;
    let res = await fetch(proxyUrl);
    if (res.ok) {
      const json = await res.json();
      const classroom = json.success
        ? json.classroom
        : (json.data?.classroom ?? json.classroom);
      if (classroom?.stage && Array.isArray(classroom.scenes)) {
        const migrated = (classroom.scenes as Scene[]).map(migrateScene);
        return { stage: classroom.stage, scenes: migrated };
      }
    }

    res = await fetch(jsonUrl, { cache: 'no-store' });
    if (!res.ok) {
      log.warn('Direct jsonUrl fetch failed:', res.status);
      return null;
    }
    const raw = (await res.json()) as EduMindClassroomWrapper;
    const unwrapped = unwrapEduMindClassroomJson(raw);
    if (!unwrapped) return null;
    const migrated = (unwrapped.scenes as Scene[]).map(migrateScene);
    return { stage: unwrapped.stage, scenes: migrated };
  } catch (e) {
    log.warn('loadClassroomFromJsonUrl error:', e);
    return null;
  }
}

export function notifyEduMindParent(event: string, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('embed') !== 'edumind') return;
  try {
    window.parent.postMessage({ source: 'openmaic-edumind', event, ...payload }, '*');
  } catch {
    /* ignore */
  }
}

/**
 * P3：场景切换订阅 + 离开时进度回传。
 * 依赖 Zustand store 的 currentSceneId（通过动态 import 解耦）。
 */
export function setupEduMindEmbedLifecycle(classroomId: string, treeNodeId?: string | null) {
  notifyEduMindParent('lesson.started', {
    classroomId,
    treeNodeId: treeNodeId ?? null,
  });

  let unsub: (() => void) | undefined;
  let lastSceneId: string | null = null;
  let sceneIndex = 0;
  let sceneTotal = 1;

  void (async () => {
    try {
      const { useStageStore } = await import('@/lib/store');
      const state = useStageStore.getState();
      sceneTotal = Math.max(state.scenes?.length || 1, 1);
      lastSceneId = state.currentSceneId;
      sceneIndex = Math.max(
        0,
        (state.scenes || []).findIndex((s: { id: string }) => s.id === lastSceneId),
      );

      unsub = useStageStore.subscribe((s) => {
        if (!s.currentSceneId || s.currentSceneId === lastSceneId) return;
        lastSceneId = s.currentSceneId;
        sceneTotal = Math.max(s.scenes?.length || 1, 1);
        sceneIndex = Math.max(
          0,
          (s.scenes || []).findIndex((sc: { id: string }) => sc.id === lastSceneId),
        );
        const progress = Math.min(
          99,
          Math.round(((sceneIndex + 1) / sceneTotal) * 100),
        );
        notifyEduMindParent('lesson.progress', {
          classroomId,
          treeNodeId: treeNodeId ?? null,
          sceneId: lastSceneId,
          progress,
        });
        // 最后一幕视为接近完成
        if (sceneIndex >= sceneTotal - 1) {
          notifyEduMindParent('lesson.completed', {
            classroomId,
            treeNodeId: treeNodeId ?? null,
            progress: 100,
          });
        }
      });
    } catch (e) {
      log.warn('EduMind scene subscribe failed:', e);
    }
  })();

  const onLeave = () => {
    const progress = Math.min(
      99,
      Math.round(((sceneIndex + 1) / Math.max(sceneTotal, 1)) * 100),
    );
    notifyEduMindParent('lesson.progress', {
      classroomId,
      treeNodeId: treeNodeId ?? null,
      sceneId: lastSceneId,
      progress,
    });
  };
  window.addEventListener('beforeunload', onLeave);

  return () => {
    window.removeEventListener('beforeunload', onLeave);
    unsub?.();
  };
}
