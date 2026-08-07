import { useEffect, useState } from 'react';

interface ToastPayload {
  message: string;
  kind: 'info' | 'error';
}

/** 轻量全局提示：toast('已提交') / toast('失败原因', 'error') */
export function toast(message: string, kind: ToastPayload['kind'] = 'info') {
  window.dispatchEvent(new CustomEvent<ToastPayload>('knowbase-toast', { detail: { message, kind } }));
}

export function ToastHost() {
  const [current, setCurrent] = useState<ToastPayload | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      setCurrent((e as CustomEvent<ToastPayload>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setCurrent(null), 2600);
    };
    window.addEventListener('knowbase-toast', handler);
    return () => {
      window.removeEventListener('knowbase-toast', handler);
      clearTimeout(timer);
    };
  }, []);

  if (!current) return null;
  return (
    <div
      className={`fixed bottom-7 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2 text-[13px] text-white shadow-lg ${
        current.kind === 'error' ? 'bg-red-700' : 'bg-stone-800'
      }`}
    >
      {current.message}
    </div>
  );
}
