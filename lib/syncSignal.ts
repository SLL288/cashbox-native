const listeners = new Set<() => void>();
const completeListeners = new Set<() => void>();
const statusListeners = new Set<(status: AutoSyncStatus) => void>();

export type AutoSyncStatus = 'offline' | 'pending' | 'syncing' | 'synced' | 'error';

let currentStatus: AutoSyncStatus = 'pending';

export function setAutoSyncStatus(status: AutoSyncStatus) {
  currentStatus = status;
  statusListeners.forEach((listener) => listener(status));
}

export function getAutoSyncStatus() {
  return currentStatus;
}

export function requestAutoSync() {
  setAutoSyncStatus('pending');
  listeners.forEach((listener) => listener());
}

export function subscribeAutoSyncRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAutoSyncComplete() {
  completeListeners.forEach((listener) => listener());
}

export function subscribeAutoSyncComplete(listener: () => void) {
  completeListeners.add(listener);
  return () => {
    completeListeners.delete(listener);
  };
}

export function subscribeAutoSyncStatus(listener: (status: AutoSyncStatus) => void) {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}
