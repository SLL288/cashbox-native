import NetInfo from '@react-native-community/netinfo';

import { syncWithSupabase } from './sync';
import { notifyAutoSyncComplete, setAutoSyncStatus, subscribeAutoSyncRequest } from './syncSignal';
import { isSupabaseConfigured, supabase } from './supabase';

const RETRY_INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 2_500;
const REALTIME_TABLES = ['users', 'projects', 'project_users', 'daily_cash', 'transactions', 'audit_log'] as const;

export function startAutoSync() {
  let online = false;
  let syncing = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    if (!online) {
      pending = true;
      setAutoSyncStatus('offline');
      return;
    }
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    pending = false;
    setAutoSyncStatus('syncing');
    try {
      await syncWithSupabase();
      setAutoSyncStatus('synced');
      notifyAutoSyncComplete();
    } catch {
      pending = true;
      setAutoSyncStatus(online ? 'error' : 'offline');
    } finally {
      syncing = false;
      if (pending && online) schedule();
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  };

  const unsubscribeRequests = subscribeAutoSyncRequest(schedule);
  const realtimeChannel = isSupabaseConfigured && supabase
    ? REALTIME_TABLES.reduce(
      (channel, table) => channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule),
      supabase.channel('cashbox-sync')
    ).subscribe()
    : null;
  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    online = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (!online) setAutoSyncStatus('offline');
    if (online) schedule();
  });
  const interval = setInterval(() => {
    if (online) schedule();
  }, RETRY_INTERVAL_MS);

  void NetInfo.fetch().then((state) => {
    online = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (!online) setAutoSyncStatus('offline');
    if (online) schedule();
  });

  return () => {
    unsubscribeRequests();
    unsubscribeNetInfo();
    if (realtimeChannel && supabase) void supabase.removeChannel(realtimeChannel);
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}
