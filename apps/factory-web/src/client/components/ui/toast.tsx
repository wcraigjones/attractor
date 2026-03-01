// Toast API is initialized in index.html (outside Vite's module system)
// to avoid issues with Vite HMR module duplication.

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

export const toast: ToastApi = {
  success: (message: string) => {
    window.__toast?.success(message);
  },
  error: (message: string) => {
    window.__toast?.error(message);
  },
};

export function Toaster() {
  return null;
}
