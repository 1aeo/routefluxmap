/**
 * DateSliderChart - Combined bandwidth histogram + date slider
 * 
 * Features:
 * - Always centered in the display
 * - Max width to avoid crowding side content
 * - Adaptive bar widths based on available space
 * - Auto-aggregation: days → months → years based on data volume
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { DateIndex } from '../../lib/types';

interface DateSliderChartProps {
  dateIndex: DateIndex;
  currentDate: string;
  onDateChange: (date: string) => void;
  playbackSpeed?: number; // 0.1 to 4.0, default 1.0 (1x speed)
}

// Aggregation mode
type AggregationMode = 'days' | 'months' | 'years';

interface AggregatedData {
  key: string;           // The aggregation key (date, month, or year)
  label: string;         // Display label
  bandwidth: number;     // Sum or average bandwidth
  dates: string[];       // Original dates in this bucket
  startDate: string;     // First date in bucket
  endDate: string;       // Last date in bucket
}

// Constants for layout
const MAX_SLIDER_WIDTH = 700;  // Maximum width in pixels
const MIN_BAR_WIDTH = 2;       // Minimum bar width
const MAX_BAR_WIDTH = 14;      // Maximum bar width  
const IDEAL_BAR_WIDTH = 6;     // Ideal bar width
const BAR_GAP = 2;             // Gap between bars
const CONTROLS_WIDTH = 100;    // Width for prev/play/next buttons

// Thresholds for aggregation
const MAX_DAYS_DISPLAY = 120;  // Switch to months above this
const MAX_MONTHS_DISPLAY = 36; // Switch to years above this

// Format bandwidth for display
function formatBandwidth(gbits: number): string {
  if (gbits >= 1000) {
    return `${(gbits / 1000).toFixed(2)} Tbps`;
  }
  return `${gbits.toFixed(0)} Gbps`;
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

// Format month for display
function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

// Format year for display
function formatYear(yearKey: string): string {
  return yearKey;
}

// Format date for short display
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

// Get month key from date string
function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

// Get year key from date string
function getYearKey(dateStr: string): string {
  return dateStr.slice(0, 4); // YYYY
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
  
  // Average the bandwidth
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
  
  // Average the bandwidth
  yearMap.forEach(entry => {
    entry.bandwidth = entry.bandwidth / entry.dates.length;
  });
  
  return Array.from(yearMap.values());
}

export default function DateSliderChart({ dateIndex, currentDate, onDateChange, playbackSpeed = 1.0 }: DateSliderChartProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const playSpeed = Math.round(500 / playbackSpeed); // Base 500ms adjusted by speed multiplier
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
        // Leave room for side content (at least 150px on each side)
        const availableWidth = Math.min(parentWidth - 300, MAX_SLIDER_WIDTH);
        setContainerWidth(Math.max(300, availableWidth));
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  
  // Determine aggregation mode and process data
  const { aggregatedData, mode, barWidth } = useMemo(() => {
    if (!dates.length || !bandwidths.length) {
      return { aggregatedData: [], mode: 'days' as AggregationMode, barWidth: IDEAL_BAR_WIDTH };
    }
    
    // Calculate available space for bars
    const availableWidth = containerWidth - CONTROLS_WIDTH;
    
    // First, try showing all days
    let data: AggregatedData[];
    let aggregationMode: AggregationMode = 'days';
    
    if (dates.length > MAX_DAYS_DISPLAY) {
      // Try months
      const monthData = aggregateByMonth(dates, bandwidths);
      if (monthData.length > MAX_MONTHS_DISPLAY) {
        // Use years
        data = aggregateByYear(dates, bandwidths);
        aggregationMode = 'years';
      } else {
        data = monthData;
        aggregationMode = 'months';
      }
    } else {
      // Use days
      data = dates.map((date, i) => ({
        key: date,
        label: formatDate(date),
        bandwidth: bandwidths[i] || 0,
        dates: [date],
        startDate: date,
        endDate: date,
      }));
    }
    
    // Calculate bar width to fit in available space
    const totalGaps = (data.length - 1) * BAR_GAP;
    const spaceForBars = availableWidth - totalGaps;
    let calculatedBarWidth = Math.floor(spaceForBars / data.length);
    
    // Clamp bar width
    calculatedBarWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, calculatedBarWidth));
    
    return { aggregatedData: data, mode: aggregationMode, barWidth: calculatedBarWidth };
  }, [dates, bandwidths, containerWidth]);
  
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
      
      // Check if current date is within this bucket
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
  
  // Find active bucket index
  const activeBucketIndex = useMemo(() => {
    return chartData.findIndex(d => d.isActive);
  }, [chartData]);
  
  // Handle bar click - navigate to first date in bucket
  const handleBarClick = useCallback((item: AggregatedData) => {
    // If clicking on active bucket and it has multiple dates, cycle through them
    if (item.dates.includes(currentDate) && item.dates.length > 1) {
      const currentPosInBucket = item.dates.indexOf(currentDate);
      const nextPos = (currentPosInBucket + 1) % item.dates.length;
      const nextDate = item.dates[nextPos];
      onDateChange(nextDate);
      window.location.hash = `date=${nextDate}`;
    } else {
      // Navigate to first date in bucket
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
  
  // Get range labels
  const startLabel = mode === 'days' 
    ? formatDateShort(dates[0])
    : mode === 'months'
    ? formatMonth(aggregatedData[0]?.key || '')
    : aggregatedData[0]?.key || '';
    
  const endLabel = mode === 'days'
    ? formatDateShort(dates[dates.length - 1])
    : mode === 'months'
    ? formatMonth(aggregatedData[aggregatedData.length - 1]?.key || '')
    : aggregatedData[aggregatedData.length - 1]?.key || '';
  
  return (
    <div 
      ref={containerRef}
      className="bg-black/40 backdrop-blur-md rounded-lg px-4 py-3 border border-tor-green/20"
      style={{ 
        width: containerWidth,
        maxWidth: '100%',
      }}
    >
      {/* Main timeline with bars */}
      <div className="flex items-end gap-1">
        {/* Left controls - Play button stacked above Previous button */}
        <div className="flex flex-col items-center gap-3 flex-shrink-0">
          {/* Play/Pause button */}
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 transition-colors"
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
          {/* Previous button */}
          <button
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green hover:bg-tor-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous date"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        
        {/* Bandwidth bars - fixed height container */}
        <div 
          className="flex-1 flex items-end justify-center"
          style={{ 
            height: '90px',
            gap: `${BAR_GAP}px`,
          }}
        >
          {chartData.map((bar) => (
            <div
              key={bar.key}
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
                boxShadow: bar.isActive ? '0 0 6px #00ff88' : 'none',
              }}
              onClick={() => handleBarClick(bar)}
              title={`${bar.label} - ${formatBandwidth(bar.bandwidth)}`}
            >
              {/* Hover tooltip */}
              <div className="
                absolute bottom-full left-1/2 -translate-x-1/2 mb-1
                bg-black/80 backdrop-blur-md border border-tor-green/40 rounded px-2 py-1
                text-xs whitespace-nowrap
                opacity-0 group-hover:opacity-100 transition-opacity
                pointer-events-none z-20
              ">
                <div className="text-tor-green font-medium text-[10px]">
                  {bar.label}
                </div>
                <div className="text-gray-400 text-[9px]">
                  {formatBandwidth(bar.bandwidth)}
                </div>
                {mode !== 'days' && bar.dates.length > 1 && (
                  <div className="text-gray-500 text-[8px]">
                    {bar.dates.length} days
                  </div>
                )}
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
      
      {/* Date labels row */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-gray-500 w-16">{startLabel}</span>
        <div className="text-center flex-1 min-w-0">
          <div className="text-tor-green text-sm font-medium truncate">{formatDate(currentDate)}</div>
          <div className="text-gray-500 text-xs whitespace-nowrap">
            <span className="text-gray-600">Network Bandwidth: </span>
            {formatBandwidth(currentBandwidth)}
          </div>
        </div>
        <span className="text-[10px] text-gray-500 w-16 text-right">{endLabel}</span>
      </div>
      
      {/* Keyboard hint */}
      <div className="text-center text-[9px] text-gray-600 mt-1">
        ← → navigate • Space play
      </div>
    </div>
  );
}
