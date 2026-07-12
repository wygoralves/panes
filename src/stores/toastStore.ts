import { create } from "zustand";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  variant: "success" | "error" | "warning" | "info";
  message: string;
  title?: string;
  action?: ToastAction;
  duration: number;
}

interface ToastOptions {
  title?: string;
  action?: ToastAction;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (opts: {
    variant: Toast["variant"];
    message: string;
    title?: string;
    action?: ToastAction;
    duration?: number;
  }) => string;
  dismissToast: (id: string) => void;
}

const MAX_TOASTS = 5;

const DEFAULT_DURATIONS: Record<Toast["variant"], number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: ({ variant, message, title, action, duration }) => {
    const id = String(++nextId);
    const ms = duration ?? DEFAULT_DURATIONS[variant];

    set((state) => {
      let toasts = [...state.toasts, { id, variant, message, title, action, duration: ms }];
      if (toasts.length > MAX_TOASTS) {
        toasts = toasts.slice(1);
      }
      return { toasts };
    });

    return id;
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

function normalizeOptions(options?: ToastOptions | number): ToastOptions {
  if (typeof options === "number") {
    return { duration: options };
  }
  return options ?? {};
}

export const toast = {
  success: (message: string, options?: ToastOptions | number) =>
    useToastStore.getState().addToast({ variant: "success", message, ...normalizeOptions(options) }),
  error: (message: string, options?: ToastOptions | number) =>
    useToastStore.getState().addToast({ variant: "error", message, ...normalizeOptions(options) }),
  warning: (message: string, options?: ToastOptions | number) =>
    useToastStore.getState().addToast({ variant: "warning", message, ...normalizeOptions(options) }),
  info: (message: string, options?: ToastOptions | number) =>
    useToastStore.getState().addToast({ variant: "info", message, ...normalizeOptions(options) }),
};
