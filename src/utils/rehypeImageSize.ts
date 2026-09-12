import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Gives every `<img>` that points at a local SVG under `public/` the `width`
 * and `height` the file itself declares, so the browser reserves the figure's
 * box before the file arrives and nothing below it moves when it does. Without
 * them a heading under a figure sits at a position that only becomes final
 * once the SVG has loaded, and a table-of-contents link or an incoming URL
 * with a fragment lands short on a slow connection.
 *
 * Astro runs the user's rehype plugins before its own `rehype-raw`, so a figure
 * written as HTML in Markdown still arrives here as a raw string; raw strings,
 * `img` elements and MDX `<img>` nodes are all handled. A tag that already
 * carries a width or height is left alone, and so is anything that is not a
 * root-relative `.svg` that exists on disk.
 */
export default function rehypeImageSize(options: { publicDir?: string } = {}) {
  const publicDir = options.publicDir ?? fileURLToPath(new URL('../../public/', import.meta.url));

  // The files are read on every use (small and few). Note that the dev server
  // caches each compiled Markdown page, so a figure regenerated at another size
  // shows its new attributes there only after the post is touched or the server
  // restarts; a production build always reads the files fresh.
  function sizeOf(src: unknown): Size | null {
    if (typeof src !== 'string') return null;
    let path: string;
    try {
      path = decodeURIComponent(src.split(/[?#]/)[0]);
    } catch {
      return null;
    }
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      !/\.svg$/i.test(path)
    ) {
      return null;
    }
    const size = readSvgSize(join(publicDir, path));
    if (!size) {
      console.warn(
        `[rehypeImageSize] ${src}: not found under public/ or without a usable width and height; left without size attributes.`
      );
    }
    return size;
  }

  function walk(node: any): void {
    if (node.type === 'raw' && typeof node.value === 'string' && /<img/i.test(node.value)) {
      node.value = node.value.replace(IMG_TAG, (tag: string) => {
        if (/\s(?:width|height)\s*=/i.test(tag)) return tag;
        const size = sizeOf(attribute(tag, 'src'));
        return size
          ? tag.replace(
              /^<img\b/i,
              (open) => `${open} width="${size.width}" height="${size.height}"`
            )
          : tag;
      });
      return;
    }
    if (node.type === 'element' && node.tagName === 'img') {
      const properties = node.properties ?? {};
      if (properties.width == null && properties.height == null) {
        const size = sizeOf(properties.src);
        if (size) node.properties = { ...properties, width: size.width, height: size.height };
      }
      return;
    }
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      node.name === 'img' &&
      Array.isArray(node.attributes)
    ) {
      const names = node.attributes.map((attr: any) => attr.name);
      if (!names.includes('width') && !names.includes('height')) {
        const src = node.attributes.find(
          (attr: any) => attr.type === 'mdxJsxAttribute' && attr.name === 'src'
        );
        const size = sizeOf(src?.value);
        if (size) {
          node.attributes.push(
            { type: 'mdxJsxAttribute', name: 'width', value: String(size.width) },
            { type: 'mdxJsxAttribute', name: 'height', value: String(size.height) }
          );
        }
      }
      return;
    }
    node.children?.forEach(walk);
  }

  return (tree: any) => {
    walk(tree);
  };
}

type Size = { width: number; height: number };

/** A complete `<img>` tag; quoted attribute values may contain `>`. */
const IMG_TAG = /<img\b(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/gi;

function readSvgSize(file: string): Size | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const root = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  const width = pixels(attribute(root, 'width'));
  const height = pixels(attribute(root, 'height'));
  if (width && height) return { width, height };
  const viewBox =
    attribute(root, 'viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: Math.round(viewBox[2]), height: Math.round(viewBox[3]) };
  }
  return null;
}

/** The value of an attribute inside one tag (quoted or not), or undefined. */
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  );
  return match?.slice(1).find((value) => value !== undefined);
}

/** Only unitless or px lengths make a valid HTML width/height attribute. */
function pixels(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
  return match ? Math.round(Number(match[1])) || null : null;
}
