/**
 * ErrorBoundary - Catches React rendering errors
 * 
 * Prevents the entire app from crashing when a component fails.
 * Displays a user-friendly error message and allows recovery.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** Optional fallback UI to show on error */
  fallback?: ReactNode;
  /** Optional callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error in development, sanitize in production
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    } else {
      // In production, only log minimal info to avoid exposing internals
      console.error('[ErrorBoundary] An error occurred in a component');
    }

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI - use MapErrorFallback for map context
      return <MapErrorFallback />;
    }

    return this.props.children;
  }
}

/**
 * Wrapper component for map-specific errors
 */
export function MapErrorFallback(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-tor-darker">
      <div className="text-center">
        <div className="text-tor-orange text-4xl mb-4">🗺️</div>
        <h2 className="text-white text-lg font-medium mb-2">Map failed to load</h2>
        <p className="text-gray-400 text-sm mb-4">
          There was a problem loading the map visualization.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-tor-green/20 hover:bg-tor-green/30 text-tor-green rounded-lg transition-colors text-sm"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

/**
 * Wrapper component for data loading errors
 */
export function DataErrorFallback({ onRetry }: { onRetry?: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-tor-darker">
      <div className="text-center">
        <div className="text-tor-orange text-4xl mb-4">📊</div>
        <h2 className="text-white text-lg font-medium mb-2">Data unavailable</h2>
        <p className="text-gray-400 text-sm mb-4">
          Could not load relay data. Please try again.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-tor-green/20 hover:bg-tor-green/30 text-tor-green rounded-lg transition-colors text-sm"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
