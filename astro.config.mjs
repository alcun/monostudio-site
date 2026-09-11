// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://monostudio.site',
  integrations: [react()],
  build: {
    // The page's own css is a couple of KB. Served as files it was two extra
    // render-blocking round trips before anything could paint; inlined it costs
    // nothing and the first paint stops waiting on the network.
    inlineStylesheets: 'always',
  },
});
