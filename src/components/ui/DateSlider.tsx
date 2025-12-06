/**
 * DateSlider - Navigate through historical Tor data dates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DateIndex } from '../../lib/types';

interface DateSliderProps {
  dateIndex: DateIndex;
  currentDate: string;
  onDateChange: (date: string) => void;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format date for short display
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export default function DateSlider({ dateIndex, currentDate, onDateChange }: DateSliderProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000); // ms per date
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const dates = dateIndex.dates;
  const currentIndex = dates.indexOf(currentDate);
  
  // Handle slider change
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value);
    if (index >= 0 && index < dates.length) {
      onDateChange(dates[index]);
      // Update URL hash
      window.location.hash = `date=${dates[index]}`;
    }
  }, [dates, onDateChange]);
  
  // Navigate to previous date
  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      onDateChange(dates[currentIndex - 1]);
      window.location.hash = `date=${dates[currentIndex - 1]}`;
    }
  }, [currentIndex, dates, onDateChange]);
  
  // Navigate to next date
  const goToNext = useCallback(() => {
    if (currentIndex < dates.length - 1) {
      onDateChange(dates[currentIndex + 1]);
      window.location.hash = `date=${dates[currentIndex + 1]}`;
    }
  }, [currentIndex, dates, onDateChange]);
  
  // Play/pause animation
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);
  
  // Handle play animation
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        if (currentIndex < dates.length - 1) {
          onDateChange(dates[currentIndex + 1]);
          window.location.hash = `date=${dates[currentIndex + 1]}`;
        } else {
          // Loop back to start
          onDateChange(dates[0]);
          window.location.hash = `date=${dates[0]}`;
        }
      }, playSpeed);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, currentIndex, dates, onDateChange, playSpeed]);
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevious, goToNext, togglePlay]);
  
  if (dates.length <= 1) return null;
  
  return (
    <div className="bg-black/80 backdrop-blur-sm rounded-lg p-4 border border-tor-green/20 min-w-[320px]">
      {/* Date display */}
      <div className="text-center mb-3">
        <div className="text-tor-green font-bold text-lg">
          {formatDate(currentDate)}
        </div>
        <div className="text-gray-500 text-xs">
          {currentIndex + 1} of {dates.length} dates
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex items-center gap-2 mb-3">
        {/* Previous button */}
        <button
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/10 text-tor-green hover:bg-tor-green/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        {/* Play/Pause button */}
        <button
          onClick={togglePlay}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/10 text-tor-green hover:bg-tor-green/20 transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        
        {/* Slider */}
        <input
          type="range"
          min={0}
          max={dates.length - 1}
          value={currentIndex >= 0 ? currentIndex : 0}
          onChange={handleSliderChange}
          className="flex-1 h-2 bg-tor-green/20 rounded-lg appearance-none cursor-pointer accent-tor-green"
          style={{
            background: `linear-gradient(to right, #00ff88 0%, #00ff88 ${(currentIndex / (dates.length - 1)) * 100}%, rgba(0, 255, 136, 0.2) ${(currentIndex / (dates.length - 1)) * 100}%, rgba(0, 255, 136, 0.2) 100%)`,
          }}
        />
        
        {/* Next button */}
        <button
          onClick={goToNext}
          disabled={currentIndex === dates.length - 1}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/10 text-tor-green hover:bg-tor-green/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      
      {/* Date range labels */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>{formatDateShort(dates[0])}</span>
        <span>{formatDateShort(dates[dates.length - 1])}</span>
      </div>
      
      {/* Speed control (only when playing) */}
      {isPlaying && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
          <span>Speed:</span>
          <button
            onClick={() => setPlaySpeed(2000)}
            className={`px-2 py-1 rounded ${playSpeed === 2000 ? 'bg-tor-green/20 text-tor-green' : 'hover:bg-white/5'}`}
          >
            0.5x
          </button>
          <button
            onClick={() => setPlaySpeed(1000)}
            className={`px-2 py-1 rounded ${playSpeed === 1000 ? 'bg-tor-green/20 text-tor-green' : 'hover:bg-white/5'}`}
          >
            1x
          </button>
          <button
            onClick={() => setPlaySpeed(500)}
            className={`px-2 py-1 rounded ${playSpeed === 500 ? 'bg-tor-green/20 text-tor-green' : 'hover:bg-white/5'}`}
          >
            2x
          </button>
          <button
            onClick={() => setPlaySpeed(200)}
            className={`px-2 py-1 rounded ${playSpeed === 200 ? 'bg-tor-green/20 text-tor-green' : 'hover:bg-white/5'}`}
          >
            5x
          </button>
        </div>
      )}
      
      {/* Keyboard hint */}
      <div className="mt-2 text-center text-xs text-gray-600">
        ← → to navigate • Space to play
      </div>
    </div>
  );
}


