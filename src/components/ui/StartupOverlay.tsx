import { useEffect, useState } from 'react';

interface StartupOverlayProps {
  progress: number;
  status: string;
  visible: boolean;
}

export default function StartupOverlay({ progress, status, visible }: StartupOverlayProps) {
  // Use local state to handle unmount animation
  const [shouldRender, setShouldRender] = useState(visible);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (!visible) {
      // Fade out
      setOpacity(0);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 500); // 500ms fade out
      return () => clearTimeout(timer);
    } else {
      setShouldRender(true);
      // Set opacity directly - CSS transition handles animation
      // Avoid requestAnimationFrame during initial load as it can conflict with heavy work
      setOpacity(1);
    }
  }, [visible]);

  if (!shouldRender) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-tor-darker transition-opacity duration-500"
      style={{ opacity }}
    >
      <div className="w-80 text-center">
        {/* Logo or Title */}
        <div className="mb-6">
          <svg className="w-16 h-16 mx-auto text-tor-green animate-pulse" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="opacity-30" />
            <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-white tracking-wide">
            Route<span className="text-tor-green">Flux</span>Map
          </h1>
        </div>

        {/* Progress Bar Container */}
        <div className="relative h-1 w-full bg-gray-800 rounded-full overflow-hidden mb-3">
          {/* Progress Bar Fill */}
          <div
            className="absolute top-0 left-0 h-full bg-tor-green transition-all duration-300 ease-out shadow-[0_0_10px_rgba(0,255,136,0.5)]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>

        {/* Status Text */}
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-tor-green">{status}</span>
          <span className="text-gray-500">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}

