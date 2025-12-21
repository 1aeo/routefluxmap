/**
 * WebGLError - Display when WebGL is unavailable
 * 
 * Shows instructions for enabling WebGL2, particularly for
 * Tor Browser users who have it disabled by default.
 */

import type { WebGLError as WebGLErrorType } from '../../lib/hooks';

export interface WebGLErrorProps {
  /** Type of WebGL error */
  error: WebGLErrorType;
}

export default function WebGLError({ error }: WebGLErrorProps) {
  const isWebGL2Only = error === 'WEBGL2_DISABLED';
  const codeStyle = 'text-tor-green bg-black/40 px-1.5 py-0.5 rounded';

  return (
    <div className="flex items-center justify-center h-full bg-tor-darker">
      <div className="text-center max-w-md px-4">
        <div className="text-tor-orange text-4xl mb-4">🔒</div>
        <p className="text-gray-300 font-medium mb-2">
          {isWebGL2Only ? 'WebGL2 Required' : 'WebGL Required'}
        </p>
        <div className="text-gray-500 text-xs space-y-2 text-left bg-black/30 rounded-lg p-4">
          <p className="text-gray-400 mb-3">
            {isWebGL2Only
              ? 'This map requires WebGL2 for rendering. Tor Browser has WebGL2 disabled by default for privacy.'
              : 'This map requires WebGL to render. Your browser has WebGL disabled.'}
          </p>

          {!isWebGL2Only && (
            <>
              <p className="font-medium text-gray-300 mb-2">Option 1: Change Security Level</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 mb-4">
                <li>
                  Click the <strong>shield icon</strong> 🛡️ in the toolbar
                </li>
                <li>
                  Select <strong>&quot;Standard&quot;</strong> security level
                </li>
                <li>Refresh this page</li>
              </ol>
              <p className="font-medium text-gray-300 mb-2">Option 2: Enable WebGL manually</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 mb-4">
                <li>
                  Type <code className={codeStyle}>about:config</code> in the address bar
                </li>
                <li>
                  Search for <code className={codeStyle}>webgl.disabled</code> and set to{' '}
                  <code className="text-tor-green">false</code>
                </li>
              </ol>
            </>
          )}

          <p className="text-gray-300 font-medium mb-2">
            {isWebGL2Only ? 'To enable WebGL2:' : 'Then enable WebGL2:'}
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
            <li>
              Type <code className={codeStyle}>about:config</code> in the address bar
            </li>
            <li>
              Click <strong>&quot;Accept the Risk and Continue&quot;</strong>
            </li>
            <li>
              Search: <code className={codeStyle}>webgl.enable-webgl2</code>
            </li>
            <li>
              Click toggle (↔️) to set to <code className="text-tor-green">true</code>
            </li>
            <li>Refresh this page</li>
          </ol>

          <div className="mt-4 pt-3 border-t border-gray-700">
            <p className="text-gray-500">
              <strong className="text-gray-400">Privacy note:</strong> Enabling WebGL may allow some
              fingerprinting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

