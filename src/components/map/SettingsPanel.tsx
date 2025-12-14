interface SettingsPanelProps {
  show: boolean;
  pathMode: 'city' | 'country';
  setPathMode: (mode: 'city' | 'country') => void;
  trafficType: 'all' | 'hidden' | 'general';
  setTrafficType: (type: 'all' | 'hidden' | 'general') => void;
  density: number;
  setDensity: (val: number) => void;
  opacity: number;
  setOpacity: (val: number) => void;
  speed: number;
  setSpeed: (val: number) => void;
  relaySize: number;
  setRelaySize: (val: number) => void;
}

export default function SettingsPanel({
  show,
  pathMode,
  setPathMode,
  trafficType,
  setTrafficType,
  density,
  setDensity,
  opacity,
  setOpacity,
  speed,
  setSpeed,
  relaySize,
  setRelaySize,
}: SettingsPanelProps) {
  if (!show) return null;

  return (
    <div className="absolute bottom-0 left-10 ml-2 bg-black/80 backdrop-blur-md rounded-lg p-3 border border-tor-green/20 w-48 shadow-lg animate-fade-in z-20">
      
      {/* RELAY SETTINGS Header */}
      <h3 className="text-tor-green text-xs font-bold mb-3 uppercase tracking-wider">Relay Settings</h3>
      
      {/* Relay Size Slider */}
      <div className="mb-4 pb-3 border-b border-white/10">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>Node Circle Size</span>
          <span>{(relaySize * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0.01"
          max="1.0"
          step="0.01"
          value={relaySize}
          onChange={(e) => setRelaySize(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
      </div>
      
      {/* TRAFFIC SETTINGS Header */}
      <h3 className="text-tor-green text-xs font-bold mb-3 uppercase tracking-wider">Traffic Settings</h3>
      
      {/* Path Mode Selector */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">Path Mode</div>
        <div className="flex gap-1">
          <button
            onClick={() => setPathMode('city')}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              pathMode === 'city'
                ? 'bg-tor-green text-black'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
          >
            City
          </button>
          <button
            onClick={() => setPathMode('country')}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              pathMode === 'country'
                ? 'bg-tor-green text-black'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
          >
            Country
          </button>
        </div>
      </div>

      {/* Traffic Type Selector */}
      <div className="mb-3">
        <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-1">
          <span>Traffic Type</span>
          <a
            href="https://metrics.torproject.org/hidserv-dir-onions-seen.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-tor-green transition-colors"
            title="Hidden service traffic is ~3-6% of Tor traffic (estimated). Click to learn more."
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setTrafficType('all')}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              trafficType === 'all'
                ? 'bg-cyan-500 text-black'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setTrafficType('general')}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              trafficType === 'general'
                ? 'bg-tor-green text-black'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setTrafficType('hidden')}
            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              trafficType === 'hidden'
                ? 'bg-tor-orange text-black'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
            title="~3-6% of Tor traffic goes to .onion hidden services (estimated from academic research)"
          >
            Hidden
          </button>
        </div>
      </div>

      {/* Top Bandwidth Routes Slider */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span 
            className="cursor-help border-b border-dotted border-gray-500"
            title="Show the top N% of routes by bandwidth contribution"
          >
            Top Bandwidth Routes
          </span>
          <span>{(density * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0.01"
          max="1.0"
          step="0.01"
          value={density}
          onChange={(e) => setDensity(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
          title="Show the top N% of routes by bandwidth contribution"
        />
      </div>

      {/* Opacity Slider */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>Opacity</span>
          <span>{(opacity * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1.0"
          step="0.1"
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
        />
      </div>

      {/* Speed Slider */}
      <div>
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>Speed</span>
          <span>{(speed * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1.0"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
        />
      </div>
    </div>
  );
}
