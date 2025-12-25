/**
 * ErrorToast - Auto-dismissing error notification
 * Shows error messages with 10-second auto-dismiss and manual dismiss button
 */

import { useEffect, useRef } from 'react';

/** Auto-dismiss timeout in milliseconds */
const AUTO_DISMISS_MS = 10000;

/** SVG path for warning icon */
const WARNING_PATH = "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z";
/** SVG path for close icon */
const CLOSE_PATH = "M6 18L18 6M6 6l12 12";

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export default function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  // Use ref to store callback to avoid timer reset on parent re-render
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Auto-dismiss after 10 seconds (timer starts on mount only)
  useEffect(() => {
    const timerId = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timerId);
  }, []); // Empty deps - timer only starts once on mount

  return (
    <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
      <div className="bg-red-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={WARNING_PATH} />
        </svg>
        <span className="font-medium">{message}</span>
        <button 
          onClick={onDismiss}
          className="text-white/60 hover:text-white ml-1"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CLOSE_PATH} />
          </svg>
        </button>
      </div>
    </div>
  );
}

