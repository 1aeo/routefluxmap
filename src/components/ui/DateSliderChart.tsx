/**
 * DateSliderChart - Timeline control center with bandwidth histogram
 * 
 * Features:
 * - Full-width histogram bars
 * - Slider track aligned with histogram
 * - Stats row: relay count, bandwidth, location count
 * - Controls: prev/next, date display, play/pause, speed selector
 * - Auto-aggregation: days → months → years based on data volume
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { DateIndex } from '../../lib/types';
import { formatDateShort, formatMonth, formatMonthYear, formatYear } from '../../lib/utils/format';

interface DateSliderChartProps {
  dateIndex: DateIndex;
  currentDate: string;
  onDateChange: (date: string) => void;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  relayCount: number;
  locationCount: number;
}

// Aggregation mode
type AggregationMode = 'days' | 'months' | 'years';

interface AggregatedData {
  key: string;
  label: string;
  bandwidth: number;
  dates: string[];
  startDate: string;
  endDate: string;
}

// Layout constants
const MAX_SLIDER_WIDTH = 650;
const BAR_GAP = 2;
const HISTOGRAM_HEIGHT = 70;
const HORIZONTAL_PADDING = 16; // px-4 = 16px each side

// Thresholds for aggregation
const MAX_DAYS_DISPLAY = 120;
const MAX_MONTHS_DISPLAY = 36;

// Speed options
const SPEED_OPTIONS = [1, 2, 4] as const;

// Format bandwidth for display
function formatBandwidth(gbits: number): string {
  if (gbits >= 1000) {
    return `${(gbits / 1000).toFixed(2)} Tbps`;
  }
  return `${gbits.toFixed(0)} Gbps`;
}

// Get month key from date string
function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// Get year key from date string
function getYearKey(dateStr: string): string {
  return dateStr.slice(0, 4);
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

// Aggregate data by month
function aggregateByMonth(dates: string[], bandwidths: number[]): AggregatedData[] {
  const monthMap = new Map<string, AggregatedData>();
  
  dates.forEach((date, i) => {
    const monthKey = getMonthKey(date);
    const bw = bandwidths[i] || 0;
    
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        key: monthKey,
        label: formatMonth(monthKey),
        bandwidth: 0,
        dates: [],
        startDate: date,
        endDate: date,
      });
    }
    
    const entry = monthMap.get(monthKey)!;
    entry.bandwidth += bw;
    entry.dates.push(date);
    entry.endDate = date;
  });
  
  monthMap.forEach(entry => {
    entry.bandwidth = entry.bandwidth / entry.dates.length;
  });
  
  return Array.from(monthMap.values());
}

// Aggregate data by year
function aggregateByYear(dates: string[], bandwidths: number[]): AggregatedData[] {
  const yearMap = new Map<string, AggregatedData>();
  
  dates.forEach((date, i) => {
    const yearKey = getYearKey(date);
    const bw = bandwidths[i] || 0;
    
    if (!yearMap.has(yearKey)) {
      yearMap.set(yearKey, {
        key: yearKey,
        label: formatYear(yearKey),
        bandwidth: 0,
        dates: [],
        startDate: date,
        endDate: date,
      });
    }
    
    const entry = yearMap.get(yearKey)!;
    entry.bandwidth += bw;
    entry.dates.push(date);
    entry.endDate = date;
  });
  
  yearMap.forEach(entry => {
    entry.bandwidth = entry.bandwidth / entry.dates.length;
  });
  
  return Array.from(yearMap.values());
}

// Format full date for display
function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DateSliderChart({
  dateIndex,
  currentDate,
  onDateChange,
  playbackSpeed,
  onPlaybackSpeedChange,
  relayCount,
  locationCount,
}: DateSliderChartProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const playSpeed = Math.round(500 / playbackSpeed);
  const [containerWidth, setContainerWidth] = useState(MAX_SLIDER_WIDTH);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { dates, bandwidths } = dateIndex;
  const currentIndex = dates.indexOf(currentDate);
  
  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const parentWidth = containerRef.current.parentElement?.clientWidth || window.innerWidth;
        const availableWidth = Math.min(parentWidth - 300, MAX_SLIDER_WIDTH);
        setContainerWidth(Math.max(400, availableWidth));
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  
  // Calculate content width (container minus padding)
  const contentWidth = containerWidth - (HORIZONTAL_PADDING * 2);
  
  // Determine aggregation mode and process data
  const { aggregatedData, mode } = useMemo(() => {
    if (!dates.length || !bandwidths.length) {
      return { aggregatedData: [], mode: 'days' as AggregationMode };
    }
    
    let data: AggregatedData[];
    let aggregationMode: AggregationMode = 'days';
    
    if (dates.length > MAX_DAYS_DISPLAY) {
      const monthData = aggregateByMonth(dates, bandwidths);
      if (monthData.length > MAX_MONTHS_DISPLAY) {
        data = aggregateByYear(dates, bandwidths);
        aggregationMode = 'years';
      } else {
        data = monthData;
        aggregationMode = 'months';
      }
    } else {
      data = dates.map((date, i) => ({
        key: date,
        label: formatDateShort(date),
        bandwidth: bandwidths[i] || 0,
        dates: [date],
        startDate: date,
        endDate: date,
      }));
    }
    
    return { aggregatedData: data, mode: aggregationMode };
  }, [dates, bandwidths]);
  
  // Bar width is now handled by flexbox - each bar grows to fill space evenly
  // This eliminates rounding errors from Math.floor
  
  // Chart data with colors and heights
  const chartData = useMemo(() => {
    if (!aggregatedData.length) return [];
    
    const bwValues = aggregatedData.map(d => d.bandwidth);
    const minBw = Math.min(...bwValues.filter(b => b > 0));
    const maxBw = Math.max(...bwValues);
    const range = maxBw - minBw || 1;
    
    return aggregatedData.map((item) => {
      const normalized = (item.bandwidth - minBw) / range;
      const heightPercent = Math.max(15, normalized * 100);
      const isActive = item.dates.includes(currentDate);
      
      return {
        ...item,
        normalized,
        heightPercent,
        color: interpolateColor('#004d29', '#00ff88', Math.sqrt(normalized)),
        isActive,
      };
    });
  }, [aggregatedData, currentDate]);
  
  // Calculate slider progress percentage (combines bucket finding + progress calc)
  const sliderProgress = useMemo(() => {
    if (chartData.length === 0) return 0;
    const activeIndex = chartData.findIndex(d => d.isActive);
    return ((activeIndex + 0.5) / chartData.length) * 100;
  }, [chartData]);
  
  // Handle bar click
  const handleBarClick = useCallback((item: AggregatedData) => {
    if (item.dates.includes(currentDate) && item.dates.length > 1) {
      const currentPosInBucket = item.dates.indexOf(currentDate);
      const nextPos = (currentPosInBucket + 1) % item.dates.length;
      const nextDate = item.dates[nextPos];
      onDateChange(nextDate);
      window.location.hash = `date=${nextDate}`;
    } else {
      const targetDate = item.dates[0];
      onDateChange(targetDate);
      window.location.hash = `date=${targetDate}`;
    }
  }, [currentDate, onDateChange]);
  
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
  
  const currentBandwidth = bandwidths[currentIndex] || 0;
  
  // Generate year labels for display (show every few years to avoid crowding)
  const yearLabels = useMemo(() => {
    if (mode !== 'years' || aggregatedData.length === 0) return [];
    
    // Show label every N years based on count
    const labelInterval = aggregatedData.length > 15 ? 3 : aggregatedData.length > 10 ? 2 : 1;
    
    return aggregatedData
      .filter((_, i) => i % labelInterval === 0 || i === aggregatedData.length - 1)
      .map(d => ({ key: d.key, label: `'${d.key.slice(2)}` }));
  }, [mode, aggregatedData]);
  
  return (
    <div 
      ref={containerRef}
      className="bg-black/40 backdrop-blur-md rounded-lg border border-tor-green/20"
      style={{ 
        width: containerWidth,
        maxWidth: '100%',
        padding: `14px ${HORIZONTAL_PADDING}px 12px`,
      }}
    >
      {/* HISTOGRAM SECTION - Full width */}
      <div style={{ width: contentWidth }}>
        {/* Bars */}
        <div 
          className="flex items-end"
          style={{ 
            height: HISTOGRAM_HEIGHT,
            gap: `${BAR_GAP}px`,
            width: contentWidth,
          }}
        >
          {chartData.map((bar) => (
            <div
              key={bar.key}
              className={`
                relative cursor-pointer transition-all duration-100 group flex-1
                hover:opacity-100
                ${bar.isActive ? 'opacity-100' : 'opacity-60 hover:opacity-90'}
              `}
              style={{
                height: `${bar.heightPercent}%`,
                minHeight: '3px',
                backgroundColor: bar.isActive ? '#00ff88' : bar.color,
                borderRadius: '2px 2px 0 0',
                boxShadow: bar.isActive ? '0 0 8px #00ff88' : 'none',
              }}
              onClick={() => handleBarClick(bar)}
              title={`${bar.label} - ${formatBandwidth(bar.bandwidth)}`}
            >
              {/* Hover tooltip */}
              <div className="
                absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                bg-black/90 backdrop-blur-md border border-tor-green/40 rounded px-2 py-1.5
                text-xs whitespace-nowrap
                opacity-0 group-hover:opacity-100 transition-opacity
                pointer-events-none z-20
              ">
                <div className="text-tor-green font-medium text-[11px]">
                  {bar.label}
                </div>
                <div className="text-gray-400 text-[10px]">
                  {formatBandwidth(bar.bandwidth)}
                </div>
                {mode !== 'days' && bar.dates.length > 1 && (
                  <div className="text-gray-500 text-[9px]">
                    {bar.dates.length} days
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {/* Slider track - same width as histogram */}
        <div 
          className="relative h-1.5 bg-white/10 rounded-full mt-2"
          style={{ width: contentWidth }}
        >
          {/* Progress fill */}
          <div 
            className="absolute h-full bg-tor-green/30 rounded-full transition-all duration-150"
            style={{ width: `${sliderProgress}%` }}
          />
          {/* Thumb */}
          <div 
            className="absolute w-3 h-3 bg-tor-green rounded-full -top-[3px] -ml-1.5 shadow-lg shadow-tor-green/30 transition-all duration-150"
            style={{ left: `${sliderProgress}%` }}
          />
        </div>
        
        {/* Year labels - same width as histogram */}
        {mode === 'years' && yearLabels.length > 0 && (
          <div 
            className="flex justify-between mt-1.5 text-[10px] text-gray-500"
            style={{ width: contentWidth }}
          >
            {yearLabels.map(({ key, label }) => (
              <span key={key}>{label}</span>
            ))}
          </div>
        )}
        
        {/* For non-year modes, show start/end labels */}
        {mode !== 'years' && (
          <div 
            className="flex justify-between mt-1.5 text-[10px] text-gray-500"
            style={{ width: contentWidth }}
          >
            <span>
              {mode === 'days' 
                ? formatMonthYear(dates[0])
                : formatMonth(aggregatedData[0]?.key || '')}
            </span>
            <span>
              {mode === 'days'
                ? formatMonthYear(dates[dates.length - 1])
                : formatMonth(aggregatedData[aggregatedData.length - 1]?.key || '')}
            </span>
          </div>
        )}
      </div>
      
      {/* STATS ROW */}
      <div className="flex items-center justify-center gap-5 mt-3 text-sm">
        {/* Relay count */}
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-tor-green" />
          <span className="text-white font-medium">{relayCount.toLocaleString()}</span>
          <span className="text-gray-500 text-xs">relays</span>
        </span>
        
        <span className="text-gray-600">•</span>
        
        {/* Bandwidth */}
        <span className="text-white font-medium min-w-[70px] text-center">{formatBandwidth(currentBandwidth)}</span>
        
        <span className="text-gray-600">•</span>
        
        {/* Location count */}
        <span className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
          <span className="text-white font-medium">{locationCount.toLocaleString()}</span>
          <span className="text-gray-500 text-xs">locations</span>
        </span>
      </div>
      
      {/* CONTROLS ROW */}
      <div className="flex items-center justify-center gap-2 mt-2">
        {/* Previous button */}
        <button
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        {/* Date display */}
        <span className="text-tor-green font-medium text-sm min-w-[180px] text-center">
          {formatFullDate(currentDate)}
        </span>
        
        {/* Next button */}
        <button
          onClick={goToNext}
          disabled={currentIndex === dates.length - 1}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next date"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        
        {/* Spacer */}
        <div className="w-3" />
        
        {/* Play/Pause button */}
        <button
          onClick={togglePlay}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        
        {/* Speed selector */}
        <div className="flex items-center bg-black/30 rounded-md p-0.5">
          {SPEED_OPTIONS.map(speed => (
            <button
              key={speed}
              onClick={() => onPlaybackSpeedChange(speed)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                playbackSpeed === speed
                  ? 'bg-tor-green text-black font-medium'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
      
      {/* Keyboard hint */}
      <div className="text-center text-[9px] text-gray-600 mt-2">
        ← → navigate • Space play/pause
      </div>
    </div>
  );
}
