import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContentPack } from '../../packages/content/src/index.ts';

const args = process.argv.slice(2);
const unknownFlag = args.find(arg => arg.startsWith('--') && arg !== '--require-ready-assets');
const paths = args.filter(arg => !arg.startsWith('--'));
if (unknownFlag || paths.length > 1) {
  console.error('Usage: node tools/content/validate.ts [pack.json] [--require-ready-assets]');
  process.exitCode = 2;
} else {
  const path = paths[0] ? resolve(paths[0]) : fileURLToPath(new URL('../../content/dawnwell-glade/pack.json', import.meta.url));
  try {
    const input: unknown = JSON.parse(await readFile(path, 'utf8'));
    const result = validateContentPack(input, { requireReadyAssets: args.includes('--require-ready-assets') });
    for (const diagnostic of result.diagnostics) {
      const message = `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`;
      if (diagnostic.severity === 'error') console.error(message);
      else console.warn(message);
    }
    let fileErrors = 0;
    if (result.success) {
      const root = await realpath(dirname(path));
      for (const asset of result.data.assets) {
        if (asset.status !== 'ready') continue;
        try {
          const actual = await realpath(resolve(root, asset.path));
          const fromRoot = relative(root, actual);
          if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Asset resolves outside the pack');
          const checksum = createHash('sha256').update(await readFile(actual)).digest('hex');
          if (checksum !== asset.sha256) throw new Error('SHA-256 mismatch');
        } catch (error) {
          fileErrors++;
          console.error(`ERROR asset_file assets.${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (!result.success || fileErrors) process.exitCode = 1;
    else {
      const placeholders = result.diagnostics.filter(d => d.code === 'asset_placeholder').length;
      console.log(`VALID ${result.data.manifest.id}: definitions and references passed; ${placeholders} explicit asset placeholders.`);
      if (placeholders) console.log('M1 sample validity only. Original artwork/audio and release packaging are still required.');
    }
  } catch (error) {
    console.error(`ERROR input ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
