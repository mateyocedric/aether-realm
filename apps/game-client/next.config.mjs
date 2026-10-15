import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default {
  reactStrictMode: true,
  transpilePackages: ['@aether/content', '@aether/game-core'],
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingIncludes: { '/api/assets': ['../../content/dawnwell-glade/assets/**/*'] },
};
