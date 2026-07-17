'use client';

import { createLogger } from '@/lib/logger';

const log = createLogger('EduMindIntegration');

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
