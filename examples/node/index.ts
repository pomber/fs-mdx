import { createMDXSource } from 'fs-mdx';
import { start } from 'fs-mdx/next';
import fs from 'node:fs';

start(
  false, // dev mode
  './source.config.js',
  '.source',
).then(async () => {
  console.log('Fumadocs MDX started');
  const { docs, docsMeta } = await import('./.source/docs');
  // write docs to file
  fs.writeFileSync('./.out/docs.json', JSON.stringify(docs, null, 2));
  fs.writeFileSync('./.out/meta.json', JSON.stringify(docsMeta, null, 2));
  const { files } = createMDXSource(docs, docsMeta);
  fs.writeFileSync('./.out/files.json', JSON.stringify(files(), null, 2));
});
