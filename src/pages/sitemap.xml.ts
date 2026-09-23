const routes = [
  '',
  'keel',
  'fork',
  'enso',
  'bins',
  'dalen',
  'lune',
  'tide',
  'dose',
  'grateful',
  'bare-minimum',
  'about',
  'privacy',
];

export const prerender = true;

export function GET() {
  const urls = routes
    .map((route) => `  <url><loc>https://monostudio.site/${route}</loc></url>`)
    .join('\n');

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
