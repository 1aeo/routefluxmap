/**
 * LoadingBar - Progress indicator for particle generation
 * 
 * Shows a horizontal progress bar with percentage during
 * web worker particle generation.
 */

interface LoadingBarProps {
  /** Progress value from 0 to 1 */
  progress: number;
  /** Optional label text */
  label?: string;
}

export default function LoadingBar({ progress, label = 'Generating particles' }: LoadingBarProps) {
  const percent = Math.round(progress * 100);
  
  return (
    <div className="absolute top-28 left-1/2 z-50 pointer-events-none animate-fade-in" style={{ marginLeft: '-140px' }}>
      <div className="w-[280px] bg-black/80 backdrop-blur-md rounded-lg px-4 py-2 border border-tor-green/20 shadow-lg">
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="w-32 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-tor-green rounded-full transition-all duration-100 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          {/* Label and percentage */}
          <span className="text-tor-green text-xs font-medium whitespace-nowrap">
            {label} {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}

