import { useEffect, useState } from 'react';
import { getStorageUsage, type StorageUsage } from '../../persistence/storageUsage';

/** Re-estimate on mount, on focus and every 30 seconds; cheap and non-blocking. */
export function useStorageUsage(): StorageUsage | null {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  useEffect(() => {
    let alive = true;
    const update = () => {
      void getStorageUsage().then((next) => { if (alive) setUsage(next); });
    };
    update();
    const timer = setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  return usage;
}
