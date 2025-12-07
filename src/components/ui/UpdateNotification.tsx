import { useState, useEffect, useCallback, useRef } from 'react';
import { createUpdateChecker } from '../../lib/utils/data-fetch';

interface UpdateNotificationProps {
  onRefresh: () => Promise<string | null>; // Returns the new date if found
  checkIntervalMs?: number;
}

/**
 * Update notification that auto-refreshes when new data is detected,
 * then shows a toast confirming what was updated
 */
export default function UpdateNotification({ 
  onRefresh, 
  checkIntervalMs = 6 * 60 * 60 * 1000 // 6 hours
}: UpdateNotificationProps) {
  const [notification, setNotification] = useState<{
    type: 'success' | 'info';
    message: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    if (notification && notification.type === 'success') {
      timeoutRef.current = setTimeout(() => {
        setNotification(null);
      }, 10000);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [notification]);

  useEffect(() => {
    const checker = createUpdateChecker(
      async () => {
        // Auto-refresh when update detected
        setIsRefreshing(true);
        setNotification({ type: 'info', message: 'Checking for updates...' });
        
        try {
          const newDate = await onRefresh();
          if (newDate) {
            setNotification({ 
              type: 'success', 
              message: `Refreshed with new data for ${formatDate(newDate)}` 
            });
          } else {
            setNotification({ 
              type: 'success', 
              message: 'Data refreshed' 
            });
          }
        } catch (err) {
          setNotification(null); // Silently fail
        } finally {
          setIsRefreshing(false);
        }
      },
      checkIntervalMs
    );

    return () => checker.stop();
  }, [checkIntervalMs, onRefresh]);

  const handleDismiss = useCallback(() => {
    setNotification(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  if (!notification) {
    return null;
  }

  return (
    <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
      <div className="bg-tor-green/90 backdrop-blur-sm text-black px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
        {isRefreshing ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span className="font-medium">{notification.message}</span>
        <button 
          onClick={handleDismiss}
          className="text-black/60 hover:text-black ml-1"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}
