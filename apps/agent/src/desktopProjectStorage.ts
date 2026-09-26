import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DesktopProjectEntry {
  worktree: string;
  sandboxes?: string[];
}

export interface DesktopProjectStorageOptions {
  customFilePath?: string;
}

export class DesktopProjectStorage {
  private customFilePath?: string;

  constructor(options?: DesktopProjectStorageOptions) {
    this.customFilePath = options?.customFilePath;
  }

  /**
   * Resolve standard candidate paths for OpenCode Desktop's opencode.global.dat store.
   */
  public getCandidatePaths(): string[] {
    if (this.customFilePath) {
      return [this.customFilePath];
    }

    const paths: string[] = [];
    const home = os.homedir();

    if (process.env.APPDATA) {
      paths.push(path.join(process.env.APPDATA, 'ai.opencode.desktop', 'opencode.global.dat'));
    }
    paths.push(path.join(home, 'Library', 'Application Support', 'ai.opencode.desktop', 'opencode.global.dat'));
    paths.push(path.join(home, '.config', 'ai.opencode.desktop', 'opencode.global.dat'));

    return paths;
  }

  /**
   * Read and validate desktop projects from OpenCode Desktop's persistent store.
   * Returns a validated list of DesktopProjectEntry records.
   */
  public readProjects(): DesktopProjectEntry[] {
    const candidatePaths = this.getCandidatePaths();

    for (const filePath of candidatePaths) {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) {
          console.warn(`[DesktopProjectStorage] Empty data file encountered at: ${filePath}`);
          continue;
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          console.warn(`[DesktopProjectStorage] Invalid non-object root at: ${filePath}`);
          continue;
        }

        // Electron store might store 'server' as an object or as a serialized JSON string
        let server = parsed.server;
        if (typeof server === 'string') {
          try {
            server = JSON.parse(server);
          } catch (e: any) {
            console.warn(`[DesktopProjectStorage] Corrupted server JSON string in ${filePath}: ${e.message}`);
            continue;
          }
        }

        if (!server || typeof server !== 'object') {
          continue;
        }

        const localProjects = server?.projects?.local;
        if (!Array.isArray(localProjects)) {
          continue;
        }

        const validated: DesktopProjectEntry[] = [];
        for (const item of localProjects) {
          if (!item || typeof item !== 'object') continue;
          if (typeof item.worktree !== 'string' || !item.worktree.trim()) continue;

          let sandboxes: string[] | undefined = undefined;
          if (Array.isArray(item.sandboxes)) {
            sandboxes = item.sandboxes.filter((s: any): s is string => typeof s === 'string' && Boolean(s.trim()));
          }

          validated.push({
            worktree: item.worktree.trim(),
            sandboxes,
          });
        }

        return validated;
      } catch (err: any) {
        console.warn(`[DesktopProjectStorage] Error reading desktop storage at ${filePath}: ${err.message}`);
      }
    }

    return [];
  }
}
