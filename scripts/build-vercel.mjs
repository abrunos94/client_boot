import fs from 'node:fs';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const apiDir = path.join(rootDir, 'api');
const outSrcDir = path.join(apiDir, '_src');

const EXCLUDED_FILES = new Set([
  'demo-cli.ts',
  'dev-server.ts',
  'test-supabase-live.ts',
]);

function cleanDirectory(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function compileDirectory(currentSrcDir, currentOutDir, stripFn) {
  fs.mkdirSync(currentOutDir, { recursive: true });
  for (const entry of fs.readdirSync(currentSrcDir, { withFileTypes: true })) {
    const srcPath = path.join(currentSrcDir, entry.name);
    if (entry.isDirectory()) {
      compileDirectory(srcPath, path.join(currentOutDir, entry.name), stripFn);
      continue;
    }
    if (!entry.name.endsWith('.ts') || EXCLUDED_FILES.has(entry.name)) {
      continue;
    }

    const tsCode = fs.readFileSync(srcPath, 'utf8');
    const stripped = stripFn(tsCode, { mode: 'strip' });
    const jsCode = stripped.replace(
      /(from\s+['"][^'"]+)\.ts(['"])/g,
      '$1.js$2'
    );

    const outName = entry.name.replace(/\.ts$/, '.js');
    fs.writeFileSync(path.join(currentOutDir, outName), jsCode, 'utf8');
  }
}

if (typeof nodeModule.stripTypeScriptTypes === 'function') {
  cleanDirectory(outSrcDir);
  compileDirectory(srcDir, outSrcDir, nodeModule.stripTypeScriptTypes);

  const legacyTsWebhook = path.join(apiDir, 'webhook.ts');
  if (fs.existsSync(legacyTsWebhook)) {
    fs.rmSync(legacyTsWebhook, { force: true });
  }

  const entrypointJs = `import vercelWebhookHandler, { config, handleWebhookRequest } from './_src/webhook.js';

export { config, handleWebhookRequest };
export default vercelWebhookHandler;
`;

  fs.writeFileSync(path.join(apiDir, 'webhook.js'), entrypointJs, 'utf8');
  console.log('[build-vercel] Generated api/webhook.js and api/_src/**/*.js');
} else {
  console.log('[build-vercel] Using pre-compiled api/webhook.js and api/_src/**/*.js');
}
