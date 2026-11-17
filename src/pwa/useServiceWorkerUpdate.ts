import { useCallback, useEffect, useRef, useState } from 'react';
import { applyServiceWorkerUpdate, registerServiceWorker } from './registerServiceWorker';

export interface ServiceWorkerUpdate {
  updateReady: boolean;
  applyUpdate: () => void;
}

/** Shows an explicit update affordance instead of reloading under the user's cursor. */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [updateReady, setUpdateReady] = useState(false);
  const reloading = useRef(false);

  useEffect(() => registerServiceWorker(() => setUpdateReady(true)), []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const applyUpdate = useCallback(() => {
    setUpdateReady(false);
    void applyServiceWorkerUpdate();
  }, []);

  return { updateReady, applyUpdate };
}
