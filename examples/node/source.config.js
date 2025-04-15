import { defineDocs, defineConfig } from 'fs-mdx/config';

const docsData = defineDocs({
  dir: 'content/docs',
  localized: true,
  output: 'docs',
  docs: {
    async: true,
  },
});
export const docs = docsData.docs;
export const docsMeta = docsData.meta;

// const cookbookData = defineDocs({
//   dir: 'content/cookbook',
//   output: 'cookbook',
//   docs: {
//     async: true,
//   },
// });

// export const cookbook = cookbookData.docs;
// export const cookbookMeta = cookbookData.meta;

export default defineConfig();
