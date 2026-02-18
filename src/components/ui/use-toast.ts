"use client";

import * as React from "react";

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000;

type ToasterToast = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: "default" | "destructive";
};

type Toast = ToasterToast;

const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

const dispatch = (action: { type: "ADD" | "REMOVE"; toast?: ToasterToast; toastId?: string }) => {
  switch (action.type) {
    case "ADD":
      toasts = [action.toast!, ...toasts].slice(0, TOAST_LIMIT);
      break;
    case "REMOVE":
      toasts = toasts.filter((toast) => toast.id !== action.toastId);
      break;
  }
  listeners.forEach((listener) => listener(toasts));
};

const addToRemoveQueue = (toastId: string) => {
  setTimeout(() => dispatch({ type: "REMOVE", toastId }), TOAST_REMOVE_DELAY);
};

export type ToastProps = Pick<ToasterToast, "title" | "description" | "action" | "variant">;

export const toast = ({ title, description, action, variant }: ToastProps = {}) => {
  const id = crypto.randomUUID();

  dispatch({ type: "ADD", toast: { id, title, description, action, variant } });
  addToRemoveQueue(id);

  return {
    id,
    dismiss: () => dispatch({ type: "REMOVE", toastId: id }),
  };
};

export const useToast = () => {
  const [state, setState] = React.useState<Toast[]>([]);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return {
    toasts: state,
    toast,
    dismiss: (toastId: string) => dispatch({ type: "REMOVE", toastId }),
  };
};

export type { Toast };
