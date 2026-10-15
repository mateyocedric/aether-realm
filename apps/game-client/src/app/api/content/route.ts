import { getContentPack } from '../../../server/content';

export function GET() {
  try { return Response.json(getContentPack()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid content.' }, { status: 500 }); }
}
