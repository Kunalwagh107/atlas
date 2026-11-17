export interface StorageUsage {
  usage: number;
  quota: number;
  ratio: number;
}

/** Browser storage estimate; null when the API is unavailable or blocked. */
export async function getStorageUsage(): Promise<StorageUsage | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    const usage = Number(estimate.usage ?? 0);
    const quota = Number(estimate.quota ?? 0);
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null;
    return { usage, quota, ratio: Math.min(1, usage / quota) };
  } catch {
    return null;
  }
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** power;
  return `${amount >= 10 || power === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[power]}`;
}

/** A user-facing warning, or null when storage is comfortably below the limit. */
export function storageWarning(usage: StorageUsage | null): string | null {
  if (!usage) return null;
  if (usage.ratio >= 0.9) return `Browser storage is almost full (${Math.round(usage.ratio * 100)}%). Export a backup and remove unused images.`;
  if (usage.ratio >= 0.75) return `Browser storage is filling up (${Math.round(usage.ratio * 100)}%). Consider exporting a backup.`;
  return null;
}
