import { create } from "zustand";

interface Toast {
  id: string;
  variant: "success" | "error" | "warning" | "info";
  message: string;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (opts: {
    variant: Toast["variant"];
    message: string;
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

  addToast: ({ variant, message, duration }) => {
    const id = String(++nextId);
    const ms = duration ?? DEFAULT_DURATIONS[variant];

    set((state) => {
      let toasts = [...state.toasts, { id, variant, message, duration: ms }];
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

export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ variant: "success", message, duration }),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ variant: "error", message, duration }),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ variant: "warning", message, duration }),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ variant: "info", message, duration }),
};
