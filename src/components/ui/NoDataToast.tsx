/**
 * Persistent toast shown when relay data is unavailable for a date
 * Does not auto-dismiss - stays until data becomes available
 */

interface NoDataToastProps {
  message?: string;
}

export default function NoDataToast({ 
  message = "No relay data found for this date" 
}: NoDataToastProps) {
  return (
    <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
      <div className="bg-amber-500/90 backdrop-blur-sm text-black px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
          />
        </svg>
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}


