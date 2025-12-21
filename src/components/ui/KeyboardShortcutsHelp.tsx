/**
 * KeyboardShortcutsHelp - Modal showing all available keyboard shortcuts
 * Grouped by category: Navigation, Playback, Layers, Interface
 */

// Static shortcut data - defined at module level to avoid recreation
const shortcutGroups = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: '←', description: 'Previous date' },
      { key: '→', description: 'Next date' },
      { key: '+', description: 'Zoom in' },
      { key: '-', description: 'Zoom out' },
    ],
  },
  {
    title: 'Playback',
    shortcuts: [
      { key: 'Space', description: 'Play / Pause' },
      { key: 'Home', description: 'First date' },
      { key: 'End', description: 'Last date' },
    ],
  },
  {
    title: 'Layers',
    shortcuts: [
      { key: 'C', description: 'Toggle countries' },
      { key: 'R', description: 'Toggle relays' },
      { key: 'P', description: 'Toggle particles' },
    ],
  },
  {
    title: 'Interface',
    shortcuts: [
      { key: 'S', description: 'Settings panel' },
      { key: 'H', description: 'Cinema mode' },
      { key: '?', description: 'This help' },
      { key: 'Esc', description: 'Close' },
    ],
  },
];

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 bg-black/60 border border-tor-green/30 rounded text-tor-green text-xs font-mono font-medium">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-tor-darker/95 backdrop-blur-md rounded-xl border border-tor-green/30 shadow-2xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-tor-green/20">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-tor-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 5h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2zm1 4h2m2 0h2m2 0h2M7 12h2m2 0h2m2 0h2M8 15h8" />
            </svg>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-bold text-tor-green uppercase tracking-wider mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div 
                    key={shortcut.key}
                    className="flex items-center justify-between"
                  >
                    <span className="text-gray-300 text-sm">{shortcut.description}</span>
                    <KeyBadge>{shortcut.key}</KeyBadge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-black/30 border-t border-tor-green/10 text-center">
          <p className="text-gray-500 text-xs">
            Press <KeyBadge>?</KeyBadge> anytime to show this help
          </p>
        </div>
      </div>
    </div>
  );
}

