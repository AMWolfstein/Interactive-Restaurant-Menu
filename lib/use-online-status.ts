"use client";

import { useEffect, useState } from "react";

/** حالة الشبكة الحية للواجهة؛ القيمة الأولى متفائلة حتى لا يحصل اختلاف بين SSR والمتصفح. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
