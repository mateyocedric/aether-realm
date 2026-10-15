import sample from '../../../../content/dawnwell-glade/pack.json';
import { validateContentPack } from '@aether/content';

export function getContentPack() {
  const result = validateContentPack(sample);
  if (!result.success) throw new Error(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.path}: ${d.message}`).join('\n'));
  return result.data;
}
