"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (isLocalDev) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
      if (window.caches) {
        void caches.keys().then((keys) => {
          keys.forEach((key) => {
            void caches.delete(key);
          });
        });
      }
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
