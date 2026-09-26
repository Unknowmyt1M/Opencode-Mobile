/**
 * Platform-aware path normalization and comparison utilities.
 * Pure TypeScript / JavaScript — completely platform-neutral with zero Node-specific dependencies
 * so it can safely execute in browsers, React Native, Vite, Node, and Bun environments.
 */

export type PathPlatform = 'win32' | 'posix';

/**
 * Returns true if the path exhibits Windows characteristics (drive letter like C:\ or UNC network path like \\server\share).
 */
export function isWindowsPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  // Drive letter: e.g. C:\ or C:/ or d:/ or C:
  if (/^[a-zA-Z]:([\\/]|$)/.test(p)) return true;
  // UNC path: e.g. \\server\share or //server/share
  if (/^(\\\\|\/\/)[^\\\/]+/.test(p)) return true;
  return false;
}

/**
 * Normalize file/directory path across operating systems:
 * - Converts all backslashes to forward slashes.
 * - Trims multiple consecutive slashes (preserving leading / or // for UNC).
 * - Strips trailing slashes (except root '/' or Windows root drive e.g. 'c:/').
 * - Preserves case on Linux / macOS (POSIX) while performing case-folding on Windows.
 *
 * @param p Path string to normalize
 * @param platform Explicit platform override ('win32' or 'posix'). If omitted, auto-detected from path structure.
 */
export function normalizePath(p?: string, platform?: PathPlatform): string {
  if (!p || typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed) return '';

  // 1. Determine platform semantics before altering trailing slashes
  const isWin = platform ? platform === 'win32' : isWindowsPath(trimmed);

  // 2. Replace all backslashes with forward slashes
  let normalized = trimmed.replace(/\\/g, '/');

  // 3. Collapse redundant slashes (preserve leading slash or double slash for UNC)
  const isUnc = normalized.startsWith('//');
  normalized = normalized.replace(/\/+/g, '/');
  if (isUnc && !normalized.startsWith('//')) {
    normalized = '/' + normalized;
  }

  // 4. Remove trailing slashes unless root '/' or root drive 'C:/'
  if (normalized.length > 1 && normalized.endsWith('/')) {
    if (!/^[a-zA-Z]:\/$/.test(normalized)) {
      normalized = normalized.replace(/\/+$/, '');
    }
  }

  // Ensure root drive has trailing slash e.g. 'C:' -> 'c:/'
  if (/^[a-zA-Z]:$/.test(normalized)) {
    normalized = normalized + '/';
  }

  if (isWin) {
    // Windows paths: case-insensitive comparison semantics
    // Lowercase drive letter and entire path for deterministic keying and equality
    return normalized.toLowerCase();
  }

  // POSIX (Linux/macOS): case-sensitive! Preserve exact case
  return normalized;
}

/**
 * Checks if two filesystem paths refer to the same logical location,
 * respecting Windows case-insensitivity and POSIX case-sensitivity.
 */
export function arePathsEqual(a?: string, b?: string, platform?: PathPlatform): boolean {
  if (!a || !b) return Boolean(!a && !b);
  return normalizePath(a, platform) === normalizePath(b, platform);
}

/**
 * Checks whether child is equal to parent or directly contained within parent directory.
 */
export function isSubPath(child?: string, parent?: string, platform?: PathPlatform): boolean {
  if (!child || !parent) return false;
  const nChild = normalizePath(child, platform);
  const nParent = normalizePath(parent, platform);
  if (!nChild || !nParent) return false;

  if (nChild === nParent) return true;
  if (nParent === '/') return nChild.startsWith('/');

  return nChild.startsWith(nParent + '/');
}
