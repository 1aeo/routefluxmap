/**
 * DateSliderChart - Combined bandwidth histogram + date slider
 * Bars integrated into timeline with navigation arrows at ends
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { DateIndex } from '../../lib/types';

interface DateSliderChartProps {
  dateIndex: DateIndex;
  currentDate: string;
  onDateChange: (date: string) => void;
}

// Format bandwidth for display
function formatBandwidth(gbits: number): string {
  if (gbits >= 1000) {
    return `${(gbits / 1000).toFixed(1)} Tbps`;
  }
  return `${gbits.toFixed(1)} Gbps`;
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

// Interpolate between two colors
function interpolateColor(color1: string, color2: string, factor: number): string {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  
  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;
  
  const r2 = (c2 >> 16) & 0xff;
  const g2 = (c2 >> 8) & 0xff;
  const b2 = c2 & 0xff;
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  return `rgb(${r}, ${g}, ${b})`;
}

export default function DateSliderChart({ dateIndex, currentDate, onDateChange }: DateSliderChartProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const { dates, bandwidths, min, max } = dateIndex;
  const currentIndex = dates.indexOf(currentDate);
  
  // Calculate chart data
  const chartData = useMemo(() => {
    if (!dates.length || !bandwidths.length) return [];
    
    const minBw = min.bandwidth;
    const maxBw = max.bandwidth;
    const range = maxBw - minBw || 1;
    
    return dates.map((date, i) => {
      const bw = bandwidths[i] || 0;
      const normalized = (bw - minBw) / range;
      const heightPercent = Math.max(15, normalized * 100);
      
      return {
        date,
        bandwidth: bw,
        normalized,
        heightPercent,
        color: interpolateColor('#004d29', '#00ff88', Math.sqrt(normalized)),
        isActive: date === currentDate,
      };
    });
  }, [dates, bandwidths, min, max, currentDate]);
  
  // Handle bar click
  const handleBarClick = useCallback((date: string) => {
    onDateChange(date);
    window.location.hash = `date=${date}`;
  }, [onDateChange]);
  
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
  
  if (chartData.length <= 1) return null;
  
  // Calculate bar dimensions based on number of dates
  const barWidth = Math.max(3, Math.min(12, 300 / dates.length));
  const currentBandwidth = bandwidths[currentIndex] || 0;
  
  return (
    <div className="bg-black/40 backdrop-blur-md rounded-lg px-4 py-3 border border-tor-green/20 inline-block min-w-[420px]">
      {/* Main timeline with bars */}
      <div className="flex items-end gap-1">
        {/* Previous button */}
        <button
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        {/* Play/Pause button */}
        <button
          onClick={togglePlay}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 transition-colors"
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
        
        {/* Bandwidth bars - fixed height container (90px = 60px + 50%) */}
        <div 
          className="flex-1 flex items-end justify-center gap-2"
          style={{ height: '90px' }}
        >
          {chartData.map((bar) => (
            <div
              key={bar.date}
              className={`
                relative cursor-pointer transition-all duration-100 group
                hover:opacity-100
                ${bar.isActive ? 'opacity-100' : 'opacity-60 hover:opacity-90'}
              `}
              style={{
                width: `${barWidth}px`,
                height: `${bar.heightPercent}%`,
                minHeight: '3px',
                backgroundColor: bar.isActive ? '#00ff88' : bar.color,
                borderRadius: '1px 1px 0 0',
                boxShadow: bar.isActive ? '0 0 4px #00ff88' : 'none',
              }}
              onClick={() => handleBarClick(bar.date)}
              title={`${formatDate(bar.date)} - ${formatBandwidth(bar.bandwidth)}`}
            >
              {/* Hover tooltip */}
              <div className="
                absolute bottom-full left-1/2 -translate-x-1/2 mb-1
                bg-black/60 backdrop-blur-md border border-tor-green/40 rounded px-1.5 py-0.5
                text-xs whitespace-nowrap
                opacity-0 group-hover:opacity-100 transition-opacity
                pointer-events-none z-20
              ">
                <div className="text-tor-green font-medium text-[9px]">
                  {formatDate(bar.date)}
                </div>
                <div className="text-gray-400 text-[9px]">
                  {formatBandwidth(bar.bandwidth)}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Next button */}
        <button
          onClick={goToNext}
          disabled={currentIndex === dates.length - 1}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      
      {/* Date labels row - fixed layout */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-gray-500 w-12">{formatDateShort(dates[0])}</span>
        <div className="text-center flex-1">
          <div className="text-tor-green text-sm font-medium">{formatDate(currentDate)}</div>
          <div className="text-gray-500 text-xs whitespace-nowrap">
            <span className="text-gray-600">Network Bandwidth: </span>
            {formatBandwidth(currentBandwidth)}
          </div>
        </div>
        <span className="text-[10px] text-gray-500 w-12 text-right">{formatDateShort(dates[dates.length - 1])}</span>
      </div>
      
      {/* Keyboard hint */}
      <div className="text-center text-[9px] text-gray-600 mt-1">
        ← → navigate • Space play
      </div>
    </div>
  );
}

