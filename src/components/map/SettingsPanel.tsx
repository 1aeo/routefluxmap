import { config } from '../../lib/config';

interface SettingsPanelProps {
  show: boolean;
  trafficType: 'all' | 'hidden' | 'general';
  setTrafficType: (type: 'all' | 'hidden' | 'general') => void;
  density: number;
  setDensity: (val: number) => void;
  opacity: number;
  setOpacity: (val: number) => void;
  speed: number;
  setSpeed: (val: number) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (val: number) => void;
}

export default function SettingsPanel({
  show,
  trafficType,
  setTrafficType,
  density,
  setDensity,
  opacity,
  setOpacity,
  speed,
  setSpeed,
  playbackSpeed,
  setPlaybackSpeed
}: SettingsPanelProps) {
  if (!show) return null;

  return (
    <div className="absolute bottom-0 left-10 ml-2 bg-black/80 backdrop-blur-md rounded-lg p-3 border border-tor-green/20 w-48 shadow-lg animate-fade-in z-20">
      
      {/* TRAFFIC SETTINGS Header */}
      <h3 className="text-tor-green text-xs font-bold mb-3 uppercase tracking-wider">Traffic Settings</h3>
      
      {/* Type Selector */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 mb-1">Type</div>
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
          >
            Hidden
          </button>
        </div>
      </div>

      {/* Density Slider */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>Density</span>
          <span>{(density * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1.0"
          step="0.1"
          value={density}
          onChange={(e) => setDensity(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
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
      <div className="mb-3">
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

      {/* PLAYBACK Header */}
      <h3 className="text-tor-green text-xs font-bold mb-3 mt-4 pt-3 border-t border-white/10 uppercase tracking-wider">Playback</h3>
      
      {/* Playback Speed Slider */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>Speed</span>
          <span>{playbackSpeed}x</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="4"
          step="0.1"
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
        />
      </div>
    </div>
  );
}

