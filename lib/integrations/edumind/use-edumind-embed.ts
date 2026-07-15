'use client';

import { useSearchParams } from 'next/navigation';

/** EduMind iframe 嵌入：`?embed=edumind` */
export function useEduMindEmbed(): boolean {
  const searchParams = useSearchParams();
  return searchParams?.get('embed') === 'edumind';
}
