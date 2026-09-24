import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from './toast-context';

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
