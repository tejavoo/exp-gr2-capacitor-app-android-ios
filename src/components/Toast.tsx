import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage { id: string; message: string; type: ToastType; }

const listeners: ((t: ToastMessage[]) => void)[] = [];
let toasts: ToastMessage[] = [];

const notify = () => listeners.forEach(fn => fn([...toasts]));

export const showToast = (message: string, type: ToastType = 'info', ms = 3500) => {
  const id = Math.random().toString(36).slice(2);
  toasts.push({ id, message, type });
  notify();
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  }, ms);
};

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: 'rgba(63,185,80,0.15)',  border: 'rgba(63,185,80,0.4)',  text: '#3fb950' },
  error:   { bg: 'rgba(248,81,73,0.15)', border: 'rgba(248,81,73,0.4)', text: '#f85149' },
  warning: { bg: 'rgba(210,153,34,0.15)',border: 'rgba(210,153,34,0.4)',text: '#d29922' },
  info:    { bg: 'rgba(88,166,255,0.12)', border: 'rgba(88,166,255,0.3)', text: '#58a6ff' },
};

export function ToastContainer() {
  const [toastList, setToastList] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.push(setToastList);
    return () => { listeners.splice(listeners.indexOf(setToastList), 1); };
  }, []);

  return (
    <div
      className="fixed z-[60] flex flex-col gap-2 pointer-events-none left-1/2 -translate-x-1/2 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+56px)] w-[min(92vw,360px)] lg:left-auto lg:translate-x-0 lg:top-auto lg:right-4 lg:bottom-4 lg:w-auto"
      role="status"
      aria-live="polite"
    >
      {toastList.slice(-3).map(t => {
        const c = COLORS[t.type];
        return (
          <div
            key={t.id}
            className="toast-enter px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg lg:max-w-xs"
            style={{ background: 'rgba(19,19,22,.94)', boxShadow: `inset 0 0 0 999px ${c.bg}`, border: `1px solid ${c.border}`, color: c.text, backdropFilter: 'blur(10px)' }}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
