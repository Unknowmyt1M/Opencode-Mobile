import { addCollection } from '@iconify/react';
import vscodeIconsSubset from './vscodeIconsSubset.json';

// Initialize the local icon collection immediately
try {
  addCollection(vscodeIconsSubset as any);
} catch (e) {
  console.warn('Failed to register vscode-icons collection:', e);
}

const EXACT_FILENAMES: Record<string, string> = {
  'package.json': 'vscode-icons:file-type-node',
  'pnpm-lock.yaml': 'vscode-icons:file-type-pnpm',
  'package-lock.json': 'vscode-icons:file-type-node',
  'yarn.lock': 'vscode-icons:file-type-yarn',
  'bun.lockb': 'vscode-icons:file-type-bun',
  'bun.lock': 'vscode-icons:file-type-bun',
  'tsconfig.json': 'vscode-icons:file-type-tsconfig-official',
  'tsconfig.app.json': 'vscode-icons:file-type-tsconfig-official',
  'tsconfig.node.json': 'vscode-icons:file-type-tsconfig-official',
  'vite.config.ts': 'vscode-icons:file-type-vite',
  'vite.config.js': 'vscode-icons:file-type-vite',
  'vite.config.mjs': 'vscode-icons:file-type-vite',
  'next.config.js': 'vscode-icons:file-type-next',
  'next.config.ts': 'vscode-icons:file-type-next',
  'next.config.mjs': 'vscode-icons:file-type-next',
  'tailwind.config.js': 'vscode-icons:file-type-tailwind',
  'tailwind.config.ts': 'vscode-icons:file-type-tailwind',
  'dockerfile': 'vscode-icons:file-type-docker',
  'docker-compose.yml': 'vscode-icons:file-type-docker',
  'docker-compose.yaml': 'vscode-icons:file-type-docker',
  '.dockerignore': 'vscode-icons:file-type-docker',
  '.gitignore': 'vscode-icons:file-type-git',
  '.gitattributes': 'vscode-icons:file-type-git',
  '.gitmodules': 'vscode-icons:file-type-git',
  '.env': 'vscode-icons:file-type-dotenv',
  '.env.local': 'vscode-icons:file-type-dotenv',
  '.env.example': 'vscode-icons:file-type-dotenv',
  '.env.production': 'vscode-icons:file-type-dotenv',
  '.env.test': 'vscode-icons:file-type-dotenv',
  '.env.development': 'vscode-icons:file-type-dotenv',
  'readme.md': 'vscode-icons:file-type-markdown',
  'readme': 'vscode-icons:file-type-markdown',
  'license': 'vscode-icons:file-type-license',
  'license.md': 'vscode-icons:file-type-license',
  'cargo.toml': 'vscode-icons:file-type-cargo',
  'cargo.lock': 'vscode-icons:file-type-cargo',
  'go.mod': 'vscode-icons:file-type-go',
  'go.sum': 'vscode-icons:file-type-go',
  'requirements.txt': 'vscode-icons:file-type-pip',
  'pipfile': 'vscode-icons:file-type-pip',
  'poetry.lock': 'vscode-icons:file-type-pip',
  '.eslintrc': 'vscode-icons:file-type-eslint',
  '.eslintrc.json': 'vscode-icons:file-type-eslint',
  '.eslintrc.js': 'vscode-icons:file-type-eslint',
  'eslint.config.js': 'vscode-icons:file-type-eslint',
  '.prettierrc': 'vscode-icons:file-type-prettier',
  '.prettierrc.json': 'vscode-icons:file-type-prettier',
  'prettier.config.js': 'vscode-icons:file-type-prettier',
  'schema.prisma': 'vscode-icons:file-type-prisma'
};

const EXTENSION_MAP: Record<string, string> = {
  tsx: 'vscode-icons:file-type-reactts',
  jsx: 'vscode-icons:file-type-reactjs',
  ts: 'vscode-icons:file-type-typescript-official',
  mts: 'vscode-icons:file-type-typescript-official',
  cts: 'vscode-icons:file-type-typescript-official',
  js: 'vscode-icons:file-type-js-official',
  mjs: 'vscode-icons:file-type-js-official',
  cjs: 'vscode-icons:file-type-js-official',
  html: 'vscode-icons:file-type-html',
  htm: 'vscode-icons:file-type-html',
  css: 'vscode-icons:file-type-css',
  scss: 'vscode-icons:file-type-scss',
  sass: 'vscode-icons:file-type-scss',
  less: 'vscode-icons:file-type-less',
  json: 'vscode-icons:file-type-json',
  jsonc: 'vscode-icons:file-type-json',
  json5: 'vscode-icons:file-type-json',
  yml: 'vscode-icons:file-type-yaml',
  yaml: 'vscode-icons:file-type-yaml',
  toml: 'vscode-icons:file-type-toml',
  xml: 'vscode-icons:file-type-xml',
  md: 'vscode-icons:file-type-markdown',
  mdx: 'vscode-icons:file-type-markdown',
  markdown: 'vscode-icons:file-type-markdown',
  py: 'vscode-icons:file-type-python',
  pyw: 'vscode-icons:file-type-python',
  ipynb: 'vscode-icons:file-type-jupyter',
  sh: 'vscode-icons:file-type-shell',
  bash: 'vscode-icons:file-type-shell',
  zsh: 'vscode-icons:file-type-shell',
  ps1: 'vscode-icons:file-type-powershell',
  bat: 'vscode-icons:file-type-bat',
  cmd: 'vscode-icons:file-type-bat',
  rs: 'vscode-icons:file-type-rust',
  go: 'vscode-icons:file-type-go',
  java: 'vscode-icons:file-type-java',
  c: 'vscode-icons:file-type-c',
  h: 'vscode-icons:file-type-c',
  cpp: 'vscode-icons:file-type-cpp',
  cc: 'vscode-icons:file-type-cpp',
  cxx: 'vscode-icons:file-type-cpp',
  hpp: 'vscode-icons:file-type-cpp',
  cs: 'vscode-icons:file-type-csharp',
  php: 'vscode-icons:file-type-php',
  rb: 'vscode-icons:file-type-ruby',
  dart: 'vscode-icons:file-type-dartlang',
  swift: 'vscode-icons:file-type-swift',
  kt: 'vscode-icons:file-type-kotlin',
  kts: 'vscode-icons:file-type-kotlin',
  vue: 'vscode-icons:file-type-vue',
  svelte: 'vscode-icons:file-type-svelte',
  astro: 'vscode-icons:file-type-astro',
  sql: 'vscode-icons:file-type-sql',
  graphql: 'vscode-icons:file-type-graphql',
  gql: 'vscode-icons:file-type-graphql',
  proto: 'vscode-icons:file-type-protobuf',
  svg: 'vscode-icons:file-type-svg',
  png: 'vscode-icons:file-type-image',
  jpg: 'vscode-icons:file-type-image',
  jpeg: 'vscode-icons:file-type-image',
  gif: 'vscode-icons:file-type-image',
  webp: 'vscode-icons:file-type-image',
  ico: 'vscode-icons:file-type-image',
  bmp: 'vscode-icons:file-type-image',
  pdf: 'vscode-icons:file-type-pdf2',
  zip: 'vscode-icons:file-type-zip',
  tar: 'vscode-icons:file-type-zip',
  gz: 'vscode-icons:file-type-zip',
  '7z': 'vscode-icons:file-type-zip',
  wasm: 'vscode-icons:file-type-wasm'
};

export function resolveFileIcon(rawPath: string): string {
  if (!rawPath) return 'vscode-icons:default-file';

  // 1. Normalize backslashes
  const normalized = rawPath.replace(/\\/g, '/');

  // Check if directory
  if (normalized.endsWith('/')) {
    return 'vscode-icons:default-folder';
  }

  // 2. Extract filename from path
  const lastSlash = normalized.lastIndexOf('/');
  const baseSegment = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  // 3. Strip query parameters, hash fragments, line numbers (e.g. file.ts:10:20 or #L1-10)
  const cleanName = baseSegment.split(/[?#:]/)[0].trim();
  if (!cleanName) return 'vscode-icons:default-file';

  const lowerName = cleanName.toLowerCase();

  // 4. Exact filename match
  if (EXACT_FILENAMES[lowerName]) {
    return EXACT_FILENAMES[lowerName];
  }

  // 5. Test / spec compound extensions
  if (lowerName.endsWith('.test.ts') || lowerName.endsWith('.test.tsx') || lowerName.endsWith('.spec.ts') || lowerName.endsWith('.spec.tsx')) {
    return 'vscode-icons:file-type-vitest';
  }
  if (lowerName.endsWith('.test.js') || lowerName.endsWith('.test.jsx') || lowerName.endsWith('.spec.js') || lowerName.endsWith('.spec.jsx')) {
    return 'vscode-icons:file-type-jest';
  }

  // 6. Standard extension match
  const dotIndex = lowerName.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = lowerName.slice(dotIndex + 1);
    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }
  }

  return 'vscode-icons:default-file';
}
