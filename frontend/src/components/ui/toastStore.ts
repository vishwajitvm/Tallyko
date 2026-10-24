/** Global toast queue. Lives apart from Overlay.tsx so Button can use it without an import cycle. */
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';
export interface ToastAction { label: string; onPress: () => void }
export interface ToastItem { id: number; message: string; tone: ToastTone; action?: ToastAction }
export const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let toastId = 0;

export const toast = {
  show(message: string, tone: ToastTone = 'info', ms = 3200, action?: ToastAction) {
    const id = ++toastId;
    useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, message, tone, action }] }));
    setTimeout(() => toast.dismiss(id), ms);
    return id;
  },
  dismiss(id: number) {
    useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
  /** Act now, offer Undo for 5 s (docs/20 §1.4): `toast.undo('Offer paused', () => resume())` */
  undo(message: string, onUndo: () => void, ms = 5000) {
    return toast.show(message, 'success', ms, { label: 'Undo', onPress: onUndo });
  },
  success: (m: string) => toast.show(m, 'success'),
  error: (m: string) => toast.show(m, 'error', 5000),
  info: (m: string) => toast.show(m, 'info'),
  warning: (m: string) => toast.show(m, 'warning', 4500),
};
