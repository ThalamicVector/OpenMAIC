'use client';

import { useState, useCallback, useRef } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';

import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useMediaGenerationStore, isMediaPlaceholder } from '@/lib/store/media-generation';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SlideContent } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';
import { inlineHtmlAssets, createAssetFetcher } from './inline-assets';
import { createProxiedFetch } from './proxied-fetch';
import { buildPptxBlob } from './build-pptx-blob';

export { buildPptxBlob } from './build-pptx-blob';

const log = createLogger('ExportPPTX');

// ── Hook ──

export function useExportPPTX() {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const { t } = useI18n();

  const scenes = useStageStore((s) => s.scenes);
  const stage = useStageStore((s) => s.stage);
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();

  const ratioPx2Inch = 96 * (viewportSize / 960);
  const ratioPx2Pt = (96 / 72) * (viewportSize / 960);

  const slideScenes = scenes.filter((s) => s.content.type === 'slide');
  const slides = slideScenes.map((s) => (s.content as SlideContent).canvas);

  // Shared guard + state wrapper for export actions
  const withExportGuard = useCallback(
    (action: () => Promise<void>) => {
      if (exportingRef.current || slides.length === 0) return;
      exportingRef.current = true;
      setExporting(true);
      setTimeout(async () => {
        try {
          await action();
        } catch (err) {
          log.error('Export failed:', err);
          toast.error(t('export.exportFailed'));
        } finally {
          exportingRef.current = false;
          setExporting(false);
        }
      }, 100);
    },
    [slides.length, t],
  );

  // ── Export PPTX only ──
  const exportPPTX = useCallback(() => {
    withExportGuard(async () => {
      const fileName = stage?.name || 'slides';
      const blob = await buildPptxBlob(
        slides,
        slideScenes,
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        (key) => useMediaGenerationStore.getState().tasks[key],
      );
      saveAs(blob, `${fileName}.pptx`);
      toast.success(t('export.exportSuccess'));
    });
  }, [
    withExportGuard,
    slides,
    slideScenes,
    stage,
    viewportSize,
    viewportRatio,
    ratioPx2Inch,
    ratioPx2Pt,
    t,
  ]);

  // ── Export Resource Pack (PPTX + interactive HTML pages as ZIP) ──
  const exportResourcePack = useCallback(() => {
    withExportGuard(async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const fileName = stage?.name || 'slides';

      // 1. Generate PPTX
      const pptxBlob = await buildPptxBlob(
        slides,
        slideScenes,
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        (key) => useMediaGenerationStore.getState().tasks[key],
      );
      zip.file(`${fileName}.pptx`, pptxBlob);

      // 2. Add interactive HTML pages
      const sharedFetcher = createAssetFetcher({ fetchImpl: createProxiedFetch() });
      let interactiveIndex = 0;
      const failedAssetUrls = new Set<string>();
      for (const scene of scenes) {
        if (scene.content.type === 'interactive' && scene.content.html) {
          interactiveIndex++;
          const safeName = scene.title.replace(/[\\/:*?"<>|]/g, '_');
          const htmlFileName = `interactive/${String(interactiveIndex).padStart(2, '0')}_${safeName}.html`;
          const { html: inlinedHtml, report } = await inlineHtmlAssets(scene.content.html, {
            fetcher: sharedFetcher,
          });
          if (report.failed.length > 0) {
            log.warn(
              'Resource Pack: some interactive-scene assets could not be inlined:',
              report.failed,
            );
            for (const f of report.failed) failedAssetUrls.add(f.url);
          }
          zip.file(htmlFileName, inlinedHtml);
        }
      }

      // 3. Download ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${fileName}.zip`);
      toast.success(t('export.exportSuccess'));
      if (failedAssetUrls.size > 0) {
        const hosts = [
          ...new Set(
            [...failedAssetUrls].map((u) => {
              try {
                return new URL(u).host;
              } catch {
                return u;
              }
            }),
          ),
        ];
        toast.warning(t('export.inlinePartial', { count: failedAssetUrls.size }), {
          description: hosts.join(', '),
        });
      }
    });
  }, [
    withExportGuard,
    slides,
    slideScenes,
    scenes,
    stage,
    viewportSize,
    viewportRatio,
    ratioPx2Inch,
    ratioPx2Pt,
    t,
  ]);

  return { exporting, exportPPTX, exportResourcePack };
}
