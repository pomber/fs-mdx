import { start } from 'fs-mdx/next';

start(
  false, // dev mode
  './source.config.js',
  '.source',
).then(async () => {
  console.log('Fumadocs MDX started');
  // const { docs } = await import('./.source/index.js');
  // console.log(docs);
});
