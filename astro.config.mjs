import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import compress from 'astro-compress';
import icon from 'astro-icon';
import remarkExtractHeadings from './src/utils/remarkHeadings.ts';
import rehypeTableWrap from './src/utils/rehypeTableWrap.ts';
import rehypeImageSize from './src/utils/rehypeImageSize.ts';

export default defineConfig({
  site: 'https://asierortiz.com',
  // Only links marked data-astro-prefetch (the blog pager) are prefetched.
  prefetch: true,
  trailingSlash: 'ignore',
  integrations: [
    vue(),
    sitemap({
      // Landing page for newsletter confirmations; only reachable from the email link.
      // Tag pages are thin by nature and reachable from the listing chips.
      filter: (page) => !page.includes('/confirmed') && !page.includes('/blog/tag/'),
    }),
    icon(),
    mdx(),
    tailwind(),
    // astro-compress >= 2.4 re-encodes WebP losslessly by default, which never
    // beats a lossy source, so large WebPs stopped shrinking. Keep it lossy.
    compress({ Image: { sharp: { webp: { lossless: false } } } }),
  ],
  markdown: {
    remarkPlugins: [remarkExtractHeadings],
    rehypePlugins: [rehypeTableWrap, rehypeImageSize],
  },
  server: {
    port: 3_000,
  },
  pageExtensions: ['astro', 'md', 'mdx', 'ts'],
});
