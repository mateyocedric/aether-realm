import { validateContentPack } from '@aether/content';
import type { ContentPack } from '@aether/content';

export async function loadContent(signal: AbortSignal, url = '/api/content'): Promise<ContentPack> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Content request failed (${response.status}).`);
  const input: unknown = await response.json();
  const result = validateContentPack(input);
  if (!result.success) throw new Error(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.path}: ${d.message}`).join('\n'));
  return result.data;
}
