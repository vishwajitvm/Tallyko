import { useMemo } from 'react';
import { useData } from '@/store/data';
import { floorAges, type FloorAges } from './floorLogic';

/** The business's floor alert times (Settings → Floor alerts), with the defaults for anything not set. */
export function useFloorAges(): FloorAges {
  const t = useData((s) => s.settings?.ops_thresholds);
  return useMemo(() => floorAges(t), [t]);
}
