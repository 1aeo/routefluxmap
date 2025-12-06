/**
 * DateChart - Bandwidth histogram showing network capacity over time
 * Displays bars colored by relative bandwidth with current date highlighted
 */

import { useMemo, useCallback } from 'react';
import type { DateIndex } from '../../lib/types';

interface DateChartProps {
  dateIndex: DateIndex;
  currentDate: string;
  onDateChange: (date: string) => void;
  height?: number;
}

// Format bandwidth for display
function formatBandwidth(gbits: number): string {
  if (gbits >= 1000) {
    return `${(gbits / 1000).toFixed(1)} Tbps`;
  }
  return `${gbits.toFixed(1)} Gbps`;
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

export default function DateChart({
  dateIndex,
  currentDate,
  onDateChange,
  height = 60,
}: DateChartProps) {
  const { dates, bandwidths, min, max } = dateIndex;
  
  // Calculate chart data
  const chartData = useMemo(() => {
    if (!dates.length || !bandwidths.length) return [];
    
    const minBw = min.bandwidth;
    const maxBw = max.bandwidth;
    const range = maxBw - minBw || 1;
    
    return dates.map((date, i) => {
      const bw = bandwidths[i] || 0;
      const normalized = (bw - minBw) / range;
      const heightPercent = Math.max(10, normalized * 100); // Minimum 10% height
      
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
  
  // Calculate bar width
  const barWidth = Math.max(2, Math.min(20, 600 / dates.length));
  const gap = Math.min(2, barWidth * 0.1);
  
  if (chartData.length <= 1) return null;
  
  return (
    <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-tor-green/20">
      {/* Title */}
      <div className="text-gray-400 text-xs mb-2 flex justify-between items-center">
        <span>Network Bandwidth Over Time</span>
        <span className="text-tor-green">
          {formatBandwidth(bandwidths[dates.indexOf(currentDate)] || 0)}
        </span>
      </div>
      
      {/* Chart */}
      <div 
        className="flex items-end justify-center gap-px"
        style={{ height: `${height}px` }}
      >
        {chartData.map((bar, index) => (
          <div
            key={bar.date}
            className={`
              relative cursor-pointer transition-all duration-150 group
              hover:opacity-100
              ${bar.isActive ? 'opacity-100' : 'opacity-70'}
            `}
            style={{
              width: `${barWidth}px`,
              height: `${bar.heightPercent}%`,
              minHeight: '4px',
              backgroundColor: bar.isActive ? '#00ff88' : bar.color,
              borderRadius: '2px 2px 0 0',
              boxShadow: bar.isActive ? '0 0 8px #00ff88' : 'none',
            }}
            onClick={() => handleBarClick(bar.date)}
            title={`${new Date(bar.date).toLocaleDateString()} - ${formatBandwidth(bar.bandwidth)}`}
          >
            {/* Hover tooltip */}
            <div className="
              absolute bottom-full left-1/2 -translate-x-1/2 mb-2
              bg-black/95 border border-tor-green/40 rounded px-2 py-1
              text-xs whitespace-nowrap
              opacity-0 group-hover:opacity-100 transition-opacity
              pointer-events-none z-20
            ">
              <div className="text-tor-green font-medium">
                {new Date(bar.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <div className="text-gray-400">
                {formatBandwidth(bar.bandwidth)}
              </div>
            </div>
            
            {/* Active indicator */}
            {bar.isActive && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 
                border-l-4 border-r-4 border-t-4 
                border-l-transparent border-r-transparent border-t-tor-green"
              />
            )}
          </div>
        ))}
      </div>
      
      {/* Date labels */}
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>
          {new Date(dates[0]).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })}
        </span>
        <span>
          {new Date(dates[dates.length - 1]).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>
      
      {/* Min/Max bandwidth labels */}
      <div className="flex justify-between mt-1 text-xs text-gray-600">
        <span>Min: {formatBandwidth(min.bandwidth)}</span>
        <span>Max: {formatBandwidth(max.bandwidth)}</span>
      </div>
    </div>
  );
}


