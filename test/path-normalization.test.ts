import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  arePathsEqual,
  isSubPath,
  isWindowsPath,
} from '../packages/protocol/src/paths.js';

describe('Cross-Platform Path Normalization & Equality', () => {
  describe('isWindowsPath detection', () => {
    it('detects drive letters with backslashes and forward slashes', () => {
      expect(isWindowsPath('C:\\Users\\Aditya')).toBe(true);
      expect(isWindowsPath('c:/projects/app')).toBe(true);
      expect(isWindowsPath('D:\\Projects\\apps\\Anilili')).toBe(true);
      expect(isWindowsPath('e:/')).toBe(true);
    });

    it('detects UNC paths', () => {
      expect(isWindowsPath('\\\\server\\share\\project')).toBe(true);
      expect(isWindowsPath('//server/share/project')).toBe(true);
    });

    it('returns false for POSIX paths', () => {
      expect(isWindowsPath('/home/user/projects/app')).toBe(false);
      expect(isWindowsPath('/var/log')).toBe(false);
      expect(isWindowsPath('relative/path')).toBe(false);
    });
  });

  describe('normalizePath on Windows', () => {
    it('normalizes backslashes to forward slashes and case-folds Windows paths', () => {
      expect(normalizePath('D:\\Projects\\Apps\\Anilili')).toBe('d:/projects/apps/anilili');
      expect(normalizePath('d:/Projects/Apps/Anilili/')).toBe('d:/projects/apps/anilili');
      expect(normalizePath('C:\\Users\\Aditya\\')).toBe('c:/users/aditya');
    });

    it('handles root drive properly', () => {
      expect(normalizePath('C:\\')).toBe('c:/');
      expect(normalizePath('c:/')).toBe('c:/');
    });

    it('handles multiple consecutive slashes in Windows paths', () => {
      expect(normalizePath('D:\\\\Projects\\\\Apps\\\\Anilili')).toBe('d:/projects/apps/anilili');
    });
  });

  describe('normalizePath on POSIX (Linux / macOS)', () => {
    it('preserves exact case on Linux / macOS paths', () => {
      expect(normalizePath('/home/user/Projects/Anilili', 'posix')).toBe('/home/user/Projects/Anilili');
      expect(normalizePath('/home/user/projects/anilili', 'posix')).toBe('/home/user/projects/anilili');
      expect(normalizePath('/Opt/MyApp/', 'posix')).toBe('/Opt/MyApp');
    });

    it('strips redundant and trailing slashes but preserves case', () => {
      expect(normalizePath('/home//user///projects/App/', 'posix')).toBe('/home/user/projects/App');
      expect(normalizePath('/', 'posix')).toBe('/');
    });

    it('does NOT conflate different-cased directories on POSIX', () => {
      const pathA = normalizePath('/home/user/ProjectA', 'posix');
      const pathB = normalizePath('/home/user/projecta', 'posix');
      expect(pathA).not.toBe(pathB);
    });
  });

  describe('arePathsEqual', () => {
    it('compares Windows paths case-insensitively', () => {
      expect(arePathsEqual('D:\\Projects\\Anilili', 'd:/projects/anilili')).toBe(true);
      expect(arePathsEqual('C:\\Foo\\Bar\\', 'c:/foo/bar')).toBe(true);
      expect(arePathsEqual('D:\\Projects\\Anilili', 'D:\\Projects\\Anilili V2')).toBe(false);
    });

    it('compares POSIX paths case-sensitively', () => {
      expect(arePathsEqual('/home/user/Project', '/home/user/Project', 'posix')).toBe(true);
      expect(arePathsEqual('/home/user/Project', '/home/user/project', 'posix')).toBe(false);
    });
  });

  describe('isSubPath', () => {
    it('matches exact and subdirectories on Windows', () => {
      expect(isSubPath('D:\\Projects\\App\\src', 'd:/projects/app')).toBe(true);
      expect(isSubPath('d:/projects/app', 'D:\\Projects\\App')).toBe(true);
      expect(isSubPath('D:\\Projects\\AppV2', 'd:/projects/app')).toBe(false);
    });

    it('respects case sensitivity for POSIX subpaths', () => {
      expect(isSubPath('/home/user/App/src', '/home/user/App', 'posix')).toBe(true);
      expect(isSubPath('/home/user/app/src', '/home/user/App', 'posix')).toBe(false);
    });
  });
});
