import { useEffect, useRef } from 'react';

type DismissListener = () => void;

const dismissListeners = new Set<DismissListener>();
let isListening = false;

const dismissOnScroll = () => {
  for (const dismiss of [...dismissListeners]) dismiss();
};

function subscribeToScrollDismiss(dismiss: DismissListener) {
  dismissListeners.add(dismiss);

  if (!isListening) {
    window.addEventListener('scroll', dismissOnScroll, { capture: true, passive: true });
    isListening = true;
  }

  return () => {
    dismissListeners.delete(dismiss);

    if (dismissListeners.size === 0 && isListening) {
      window.removeEventListener('scroll', dismissOnScroll, true);
      isListening = false;
    }
  };
}

export function useScrollDismiss(isOpen: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;
    return subscribeToScrollDismiss(() => dismissRef.current());
  }, [isOpen]);
}
