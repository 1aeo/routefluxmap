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
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
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
const HISTOGRAM_HEIGHT = { desktop: 70, mobile: 45 };
const HORIZONTAL_PADDING = { desktop: 16, mobile: 8 };
const MOBILE_BREAKPOINT = 500;

// Thresholds for aggregation
const MAX_DAYS_DISPLAY = 120;
const MAX_MONTHS_DISPLAY = 36;

// Speed options
const SPEED_OPTIONS = [1, 2, 4] as const;

// Shared button styles to reduce duplication
const NAV_BTN_BASE = 'flex items-center justify-center rounded-full bg-tor-green/20 text-tor-green transition-colors';
const NAV_BTN_DISABLED = 'disabled:opacity-30 disabled:cursor-not-allowed';
const NAV_BTN_DESKTOP = 'w-7 h-7 hover:bg-tor-green/30';
const NAV_BTN_MOBILE = 'w-8 h-8 active:bg-tor-green/40';

// Reusable SVG icons
const ChevronLeftIcon = ({ size = 4 }: { size?: number }) => (
  <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
  </svg>
);
const ChevronRightIcon = ({ size = 4 }: { size?: number }) => (
  <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
  </svg>
);
const DoubleChevronRightIcon = ({ size = 4 }: { size?: number }) => (
  <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
  </svg>
);
const PlayIcon = ({ size = 3.5 }: { size?: number }) => (
  <svg className={`w-${size} h-${size}`} fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = ({ size = 3.5 }: { size?: number }) => (
  <svg className={`w-${size} h-${size}`} fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);
const LocationIcon = ({ size = 3 }: { size?: number }) => (
  <svg className={`w-${size} h-${size} text-gray-400`} fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
  </svg>
);

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

// Generic aggregation function - reduces duplication between month/year aggregation
function aggregateByPeriod(
  dates: string[],
  bandwidths: number[],
  getKey: (date: string) => string,
  formatLabel: (key: string) => string
): AggregatedData[] {
  const map = new Map<string, AggregatedData>();
  
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const key = getKey(date);
    const bw = bandwidths[i] || 0;
    
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        label: formatLabel(key),
        bandwidth: 0,
        dates: [],
        startDate: date,
        endDate: date,
      };
      map.set(key, entry);
    }
    
    entry.bandwidth += bw;
    entry.dates.push(date);
    entry.endDate = date;
  }
  
  // Convert sum to average
  for (const entry of map.values()) {
    entry.bandwidth /= entry.dates.length;
  }
  
  return Array.from(map.values());
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
  isPlaying,
  onPlayingChange,
}: DateSliderChartProps) {
  const [containerWidth, setContainerWidth] = useState(MAX_SLIDER_WIDTH);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderTrackRef = useRef<HTMLDivElement>(null);
  
  // Dragging state for slider interaction
  const [isDragging, setIsDragging] = useState(false);
  const cachedRectRef = useRef<DOMRect | null>(null);
  const lastBucketIndexRef = useRef<number>(-1);
  
  const { dates, bandwidths } = dateIndex;
  const dateToIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) m.set(dates[i], i);
    return m;
  }, [dates]);
  const currentIndex = dateToIndex.get(currentDate) ?? -1;
  
  // Boundary checks - computed once, used by multiple buttons/handlers
  const isAtStart = currentIndex <= 0;
  const isAtEnd = currentIndex < 0 || currentIndex >= dates.length - 1;
  
  // Measure container width and detect mobile
  useEffect(() => {
    const updateWidth = () => {
      const windowWidth = window.innerWidth;
      const mobile = windowWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      
      if (containerRef.current) {
        const parentWidth = containerRef.current.parentElement?.clientWidth || windowWidth;
        
        if (mobile) {
          // On mobile: use nearly full width with small padding
          const availableWidth = Math.min(parentWidth - 16, windowWidth - 16);
          setContainerWidth(Math.max(280, availableWidth));
        } else {
          // On desktop: original logic with more margin for side panels
          const availableWidth = Math.min(parentWidth - 300, MAX_SLIDER_WIDTH);
          setContainerWidth(Math.max(400, availableWidth));
        }
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  
  // Calculate content width (container minus padding) - responsive
  const horizontalPadding = isMobile ? HORIZONTAL_PADDING.mobile : HORIZONTAL_PADDING.desktop;
  const contentWidth = containerWidth - (horizontalPadding * 2);
  const histogramHeight = isMobile ? HISTOGRAM_HEIGHT.mobile : HISTOGRAM_HEIGHT.desktop;
  
  // Determine aggregation mode and process data
  const { aggregatedData, mode } = useMemo(() => {
    if (!dates.length || !bandwidths.length) {
      return { aggregatedData: [], mode: 'days' as AggregationMode };
    }
    
    let data: AggregatedData[];
    let aggregationMode: AggregationMode = 'days';
    
    if (dates.length > MAX_DAYS_DISPLAY) {
      const monthData = aggregateByPeriod(dates, bandwidths, getMonthKey, formatMonth);
      if (monthData.length > MAX_MONTHS_DISPLAY) {
        data = aggregateByPeriod(dates, bandwidths, getYearKey, formatYear);
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
  
  // Precompute static bar geometry/colors once per aggregated dataset (NOT per currentDate change)
  const staticBars = useMemo(() => {
    if (!aggregatedData.length) return [];

    const bwValues = aggregatedData.map(d => d.bandwidth);
    const positive = bwValues.filter(b => b > 0);
    const minBw = positive.length ? Math.min(...positive) : 0;
    const maxBw = bwValues.length ? Math.max(...bwValues) : 0;
    const range = maxBw - minBw || 1;

    return aggregatedData.map((item) => {
      const normalized = (item.bandwidth - minBw) / range;
      const heightPercent = Math.max(15, normalized * 100);
      return {
        ...item,
        normalized,
        heightPercent,
        color: interpolateColor('#004d29', '#00ff88', Math.sqrt(normalized)),
      };
    });
  }, [aggregatedData]);

  // Map every underlying date -> bucket index (built only when aggregatedData changes)
  const dateToBucketIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < aggregatedData.length; i++) {
      for (const d of aggregatedData[i].dates) m.set(d, i);
    }
    return m;
  }, [aggregatedData]);

  const activeBucketIndex = dateToBucketIndex.get(currentDate) ?? -1;

  // Calculate slider progress percentage (O(1) per currentDate change)
  const sliderProgress = useMemo(() => {
    const count = staticBars.length;
    if (count === 0) return 0;
    const clampedIndex = Math.max(0, Math.min(count - 1, activeBucketIndex));
    return ((clampedIndex + 0.5) / count) * 100;
  }, [activeBucketIndex, staticBars.length]);
  
  const navigateToDate = useCallback((date: string) => {
    onDateChange(date);
    window.location.hash = `date=${date}`;
  }, [onDateChange]);

  // Handle bar click
  const handleBarClick = useCallback((bucketIndex: number) => {
    const item = aggregatedData[bucketIndex];
    if (!item) return;

    // If clicking on active bucket and it has multiple dates, cycle through them
    if (bucketIndex === activeBucketIndex && item.dates.length > 1) {
      const currentPosInBucket = item.dates.indexOf(currentDate);
      const safePos = currentPosInBucket >= 0 ? currentPosInBucket : 0;
      const nextPos = (safePos + 1) % item.dates.length;
      navigateToDate(item.dates[nextPos]);
      return;
    }

    // Otherwise, jump to the first date in the bucket
    navigateToDate(item.dates[0]);
  }, [activeBucketIndex, aggregatedData, currentDate, navigateToDate]);
  
  // Store aggregatedData in ref for use in event handlers without causing re-renders
  const aggregatedDataRef = useRef(aggregatedData);
  aggregatedDataRef.current = aggregatedData;
  
  // Store navigateToDate in ref to avoid callback recreation
  const navigateToDateRef = useRef(navigateToDate);
  navigateToDateRef.current = navigateToDate;
  
  // Handle slider interaction - compute bucket index from mouse position
  // Uses cached rect and deduplicates same-bucket navigation
  const handleSliderInteraction = useCallback((clientX: number) => {
    const rect = cachedRectRef.current;
    const data = aggregatedDataRef.current;
    if (!rect || data.length === 0) return;
    
    const relativeX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, relativeX / rect.width));
    const bucketIndex = Math.min(
      data.length - 1,
      Math.floor(ratio * data.length)
    );
    
    // Skip if same bucket (avoid redundant navigation during drag)
    if (bucketIndex === lastBucketIndexRef.current) return;
    lastBucketIndexRef.current = bucketIndex;
    
    const item = data[bucketIndex];
    if (item?.dates[0]) {
      navigateToDateRef.current(item.dates[0]);
    }
  }, []); // No dependencies - uses refs
  
  // Mouse down on slider track - cache rect and attach listeners
  const handleSliderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const track = sliderTrackRef.current;
    if (!track) return;
    
    // Cache bounding rect once at drag start (avoids reflow during drag)
    cachedRectRef.current = track.getBoundingClientRect();
    lastBucketIndexRef.current = -1; // Reset to allow first click
    setIsDragging(true);
    
    // Attach listeners only when dragging
    const handleMouseMove = (ev: MouseEvent) => {
      handleSliderInteraction(ev.clientX);
    };
    
    const handleMouseUp = () => {
      cachedRectRef.current = null;
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Handle initial click position
    handleSliderInteraction(e.clientX);
  }, [handleSliderInteraction]);
  
  // Navigation functions using precomputed boundary checks
  const goToPrevious = useCallback(() => {
    if (!isAtStart) navigateToDate(dates[currentIndex - 1]);
  }, [isAtStart, currentIndex, dates, navigateToDate]);
  
  const goToNext = useCallback(() => {
    if (!isAtEnd) navigateToDate(dates[currentIndex + 1]);
  }, [isAtEnd, currentIndex, dates, navigateToDate]);
  
  const goToFirst = useCallback(() => {
    if (!isAtStart) navigateToDate(dates[0]);
  }, [isAtStart, dates, navigateToDate]);
  
  const goToLatest = useCallback(() => {
    if (!isAtEnd) navigateToDate(dates[dates.length - 1]);
  }, [isAtEnd, dates, navigateToDate]);
  
  // Play/pause animation
  const togglePlay = useCallback(() => {
    onPlayingChange(!isPlaying);
  }, [isPlaying, onPlayingChange]);
  
  // Keyboard navigation is handled by TorMap (so it works in cinema mode)
  
  if (staticBars.length <= 1) return null;
  
  const currentBandwidth = (currentIndex >= 0 ? bandwidths[currentIndex] : 0) || 0;
  
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
        padding: isMobile ? `8px ${horizontalPadding}px 6px` : `14px ${horizontalPadding}px 12px`,
        // Single source of truth for alignment:
        // histogram, slider track, and labels all use var(--content-width)
        ['--content-width' as any]: `${contentWidth}px`,
      }}
    >
      {/* HISTOGRAM SECTION - Full width */}
      <div style={{ width: 'var(--content-width)' }}>
        {/* Bars */}
        <div 
          className="flex items-end"
          style={{ 
            height: histogramHeight,
            gap: `${BAR_GAP}px`,
            width: 'var(--content-width)',
          }}
        >
          {staticBars.map((bar, i) => {
            const isActive = i === activeBucketIndex;
            return (
            <div
              key={bar.key}
              className={`
                relative cursor-pointer transition-all duration-100 group flex-1
                hover:opacity-100
                ${isActive ? 'opacity-100' : 'opacity-60 hover:opacity-90'}
              `}
              style={{
                height: `${bar.heightPercent}%`,
                minHeight: '3px',
                backgroundColor: isActive ? '#00ff88' : bar.color,
                borderRadius: '2px 2px 0 0',
                boxShadow: isActive ? '0 0 8px #00ff88' : 'none',
              }}
              onClick={() => handleBarClick(i)}
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
            );
          })}
        </div>
        
        {/* Slider track - same width as histogram, now interactive */}
        <div 
          ref={sliderTrackRef}
          className={`relative bg-white/10 rounded-full cursor-pointer select-none ${
            isDragging ? 'cursor-grabbing' : 'hover:bg-white/15'
          } ${isMobile ? 'h-1.5 mt-1.5' : 'h-2 mt-2'}`}
          style={{ width: 'var(--content-width)' }}
          onMouseDown={handleSliderMouseDown}
        >
          {/* Progress fill */}
          <div 
            className={`absolute h-full bg-tor-green/30 rounded-full pointer-events-none ${
              isDragging ? '' : 'transition-all duration-150'
            }`}
            style={{ width: `${sliderProgress}%` }}
          />
          {/* Thumb */}
          <div 
            className={`absolute bg-tor-green rounded-full shadow-lg shadow-tor-green/40 pointer-events-none ${
              isDragging ? 'scale-110' : 'transition-all duration-150 hover:scale-110'
            } ${isMobile ? 'w-3 h-3 -top-[3px] -ml-[6px]' : 'w-3.5 h-3.5 -top-[3px] -ml-[7px]'}`}
            style={{ left: `${sliderProgress}%` }}
          />
        </div>
        
        {/* Year labels - same width as histogram */}
        {mode === 'years' && yearLabels.length > 0 && (
          <div 
            className={`flex justify-between text-gray-500 ${isMobile ? 'mt-1 text-[9px]' : 'mt-1.5 text-[10px]'}`}
            style={{ width: 'var(--content-width)' }}
          >
            {yearLabels.map(({ key, label }) => (
              <span key={key}>{label}</span>
            ))}
          </div>
        )}
        
        {/* For non-year modes, show start/end labels */}
        {mode !== 'years' && (
          <div 
            className={`flex justify-between text-gray-500 ${isMobile ? 'mt-1 text-[9px]' : 'mt-1.5 text-[10px]'}`}
            style={{ width: 'var(--content-width)' }}
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
      
      {/* STATS ROW - Responsive sizing */}
      <div className={`flex items-center justify-center ${isMobile ? 'gap-2 mt-1.5 text-[10px]' : 'gap-5 mt-3 text-sm'}`}>
        <span className={`flex items-center ${isMobile ? 'gap-1' : 'gap-1.5'}`}>
          <span className={`rounded-full bg-tor-green ${isMobile ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} />
          <span className="text-white font-medium">{relayCount.toLocaleString()}</span>
          <span className={`text-gray-500 ${isMobile ? '' : 'text-xs'}`}>relays</span>
        </span>
        <span className="text-gray-600">•</span>
        <span className={`text-white font-medium ${isMobile ? '' : 'min-w-[70px] text-center'}`}>{formatBandwidth(currentBandwidth)}</span>
        <span className="text-gray-600">•</span>
        <span className={`flex items-center ${isMobile ? 'gap-0.5' : 'gap-1.5'}`}>
          <LocationIcon size={isMobile ? 2 : 3} />
          <span className="text-white font-medium">{locationCount.toLocaleString()}</span>
          {!isMobile && <span className="text-gray-500 text-xs">locations</span>}
        </span>
      </div>
      
      {/* CONTROLS ROW - Responsive */}
      <div className={`flex items-center justify-center ${isMobile ? 'gap-1.5 mt-1.5' : 'gap-2 mt-2'}`}>
        {/* Previous button */}
        <button
          onClick={goToPrevious}
          disabled={isAtStart}
          className={`${NAV_BTN_BASE} ${NAV_BTN_DISABLED} ${isMobile ? NAV_BTN_MOBILE : NAV_BTN_DESKTOP}`}
          aria-label="Previous date"
        >
          <ChevronLeftIcon size={isMobile ? 3.5 : 4} />
        </button>
        
        {/* Date display */}
        <span className={`text-tor-green font-medium text-center ${
          isMobile ? 'text-[11px] flex-1 truncate px-0.5' : 'text-sm min-w-[180px]'
        }`}>
          {isMobile 
            ? new Date(currentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : formatFullDate(currentDate)
          }
        </span>
        
        {/* Next button */}
        <button
          onClick={goToNext}
          disabled={isAtEnd}
          className={`${NAV_BTN_BASE} ${NAV_BTN_DISABLED} ${isMobile ? NAV_BTN_MOBILE : NAV_BTN_DESKTOP}`}
          aria-label="Next date"
        >
          <ChevronRightIcon size={isMobile ? 3.5 : 4} />
        </button>
        
        {/* Skip to latest button */}
        <button
          onClick={goToLatest}
          disabled={isAtEnd}
          className={`${NAV_BTN_BASE} ${NAV_BTN_DISABLED} ${isMobile ? NAV_BTN_MOBILE : NAV_BTN_DESKTOP}`}
          aria-label="Jump to latest date"
          title="Jump to latest (End)"
        >
          <DoubleChevronRightIcon size={isMobile ? 3.5 : 4} />
        </button>
        
        {/* Spacer - desktop only */}
        {!isMobile && <div className="w-3" />}
        
        {/* Play/Pause button */}
        <button
          onClick={togglePlay}
          className={`${NAV_BTN_BASE} ${isMobile ? NAV_BTN_MOBILE : NAV_BTN_DESKTOP}`}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <PauseIcon size={3.5} /> : <PlayIcon size={3.5} />}
        </button>
        
        {/* Speed selector - different UI for mobile vs desktop */}
        {isMobile ? (
          <button
            onClick={() => {
              const idx = SPEED_OPTIONS.indexOf(playbackSpeed as typeof SPEED_OPTIONS[number]);
              onPlaybackSpeedChange(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/30 text-tor-green text-[10px] font-medium active:bg-tor-green/20 transition-colors"
            aria-label={`Speed: ${playbackSpeed}x (tap to change)`}
          >
            {playbackSpeed}x
          </button>
        ) : (
          <div className="flex items-center bg-black/30 rounded-md p-0.5">
            {SPEED_OPTIONS.map(speed => (
              <button
                key={speed}
                onClick={() => onPlaybackSpeedChange(speed)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  playbackSpeed === speed ? 'bg-tor-green text-black font-medium' : 'text-gray-400 hover:text-white'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Keyboard hint - hide on mobile */}
      {!isMobile && (
        <div className="text-center text-[9px] text-gray-600 mt-2">
          ← → navigate • Home/End jump • Space play/pause
        </div>
      )}
    </div>
  );
}
