import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { getContentPack } from '../../../server/content';

export async function GET(request: Request) {
  const asset = getContentPack().assets.find(a => a.id === new URL(request.url).searchParams.get('id'));
  if (!asset || asset.status !== 'ready') return Response.json({ error: 'Asset is unavailable.' }, { status: 404 });
  try {
    const root = await realpath(resolve(process.cwd(), '../../content/dawnwell-glade'));
    const path = await realpath(resolve(root, asset.path));
    const fromRoot = relative(root, path);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Invalid asset path.');
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Asset checksum mismatch.');
    const mime: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return Response.json({ error: 'Asset file is missing or invalid.' }, { status: 500 }); }
}
