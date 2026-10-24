/**
 * Sales channels for the menu screens: the offline cache paints first, then one GET /channels refreshes
 * mark-ups and on/off switches (they may have changed on another device) and updates Billing's copy.
 */
import { useEffect, useMemo } from 'react';
import { channelsApi } from '@/api/channels';
import type { SalesChannel } from '@/api/types';
import { useData } from '@/store/data';
import { menuChannels } from './channelPricing';

export function useSalesChannels(): { channels: SalesChannel[]; menu: SalesChannel[] } {
  const channels = useData((s) => s.channels);

  useEffect(() => {
    let alive = true;
    channelsApi.list()
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        // Never keep webhook secrets in the offline cache
        useData.setState({ channels: list.map(({ webhook_secret: _secret, ...c }) => c as SalesChannel) });
      })
      .catch(() => { /* offline: the cached channels are good enough for previews */ });
    return () => { alive = false; };
  }, []);

  const menu = useMemo(() => menuChannels(channels), [channels]);
  return { channels, menu };
}
