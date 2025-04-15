import * as path from 'node:path';
import fg from 'fast-glob';
import { getTypeFromPath } from '@/utils/get-type-from-path';
import type { FileInfo } from '@/config/types';
import { type LoadedConfig } from '@/utils/load-config';
import type { DocCollection, MetaCollection } from '@/config';

export async function generateJS(
  configPath: string,
  config: LoadedConfig,
  outputPath: string,
  configHash: string,
  getFrontmatter: (file: string) => unknown | Promise<unknown>,
): Promise<string> {
  const outDir = path.dirname(outputPath);
  let asyncInit = false;
  const lines: string[] = [
    getImportCode({
      type: 'named',
      names: ['_runtime'],
      specifier: 'fs-mdx',
    }),
    getImportCode({
      type: 'namespace',
      specifier: toImportPath(configPath, outDir),
      name: '_source',
    }),
    getImportCode({
      type: 'namespace',
      specifier: 'node:path',
      name: 'path',
    }),
  ];

  config._runtime.files.clear();
  const entries = Array.from(config.collections.entries());

  // import data
  const coll = entries[0][1];
  const fileName = coll.output || 'index';

  async function getEntries(
    collectionName: string,
    collection: MetaCollection | DocCollection,
    files: FileInfo[],
  ) {
    const items = files.map(async (file, i) => {
      config._runtime.files.set(file.absolutePath, collectionName);
      const importId = `${collectionName}_${collection.type}_${i}`;
      lines.unshift(
        getImportCode({
          type: 'namespace',
          name: importId,
          specifier: `${toImportPath(file.absolutePath, outDir)}?collection=${collectionName}&hash=${configHash}`,
        }),
      );

      return `{ info: ${JSON.stringify(file)}, data: ${importId} }`;
    });

    return Promise.all(items);
  }

  async function getAsyncEntries(files: FileInfo[]) {
    if (!asyncInit) {
      lines.unshift(
        getImportCode({
          type: 'named',
          specifier: 'fs-mdx/runtime/async',
          names: ['_runtimeAsync', 'buildConfig'],
        }),
        'const [err, _sourceConfig] = buildConfig(_source)',
        'if (!_sourceConfig) throw new Error(err)',
      );

      asyncInit = true;
    }

    const entries = files.map(async (file) => {
      const frontmatter = await getFrontmatter(file.absolutePath);

      return JSON.stringify({
        info: file,
        data: frontmatter,
      });
    });

    return Promise.all(entries);
  }

  const imports = entries
    .filter(([k, collection]) => collection.type === 'doc')
    .map(([k]) =>
      getImportCode({
        type: 'named',
        names: [`${k}Data`],
        specifier: './' + fileName + '.fm.ts',
      }),
    );

  const declares = entries.map(async ([k, collection]) => {
    if (collection.type === 'docs') {
      const docs = await getCollectionFiles(collection.docs);
      const metas = await getCollectionFiles(collection.meta);

      if (collection.docs.async) {
        const docsEntries = (await getAsyncEntries(docs)).join(', ');
        const metaEntries = (await getEntries(k, collection.meta, metas)).join(
          ', ',
        );

        return `export const ${k} = _runtimeAsync.docs<typeof _source.${k}>([${docsEntries}], [${metaEntries}], "${k}", _sourceConfig)`;
      }

      const docsEntries = (await getEntries(k, collection.docs, docs)).join(
        ', ',
      );
      const metaEntries = (await getEntries(k, collection.meta, metas)).join(
        ', ',
      );

      return `export const ${k} = _runtime.docs<typeof _source.${k}>([${docsEntries}], [${metaEntries}])`;
    }

    if (collection.type === 'doc' && collection.async) {
      if (!asyncInit) {
        lines.unshift(
          getImportCode({
            type: 'named',
            specifier: 'fs-mdx/runtime/async',
            names: ['_runtimeAsync', 'buildConfig'],
          }),
          'const [err, _sourceConfig] = buildConfig(_source)',
          'if (!_sourceConfig) throw new Error(err)',
        );

        asyncInit = true;
      }

      const docEntries = `Object.entries(${k}Data).map(([k,data])=>({info:{path:k,absolutePath:path.join(process.cwd(),"${collection.dir}",data._part)},data}))`;

      return `export const ${k} = _runtimeAsync.doc<typeof _source.${k}>(${docEntries}, "${k}", _sourceConfig)`;
    }

    const files = await getCollectionFiles(collection);
    return `export const ${k} = _runtime.${collection.type}<typeof _source.${k}>([${(await getEntries(k, collection, files)).join(', ')}]);`;
  });

  const resolvedDeclares = await Promise.all(declares);

  return [
    `// @ts-nocheck -- skip type checking`,
    ...lines,
    ...imports,
    ...resolvedDeclares,
  ].join('\n');
}

async function getCollectionFiles(
  collection: DocCollection | MetaCollection,
): Promise<FileInfo[]> {
  const files = new Map<string, FileInfo>();
  const dirs = Array.isArray(collection.dir)
    ? collection.dir
    : [collection.dir];

  await Promise.all(
    dirs.map(async (dir) => {
      const result = await fg(collection.files ?? '**/*', {
        cwd: path.resolve(dir),
        absolute: true,
      });

      for (const item of result) {
        if (getTypeFromPath(item) !== collection.type) continue;

        const relativePath = path.relative(dir, item);

        files.set(item, {
          path: collection.localized
            ? getLocalizedPath(relativePath)
            : relativePath,
          absolutePath: item,
          _part: relativePath,
        });
      }
    }),
  );

  return Array.from(files.values());
}

type ImportInfo =
  | { name: string; type: 'default'; specifier: string }
  | {
      type: 'named';
      names: ([string, string] | string)[];
      specifier: string;
    }
  | {
      type: 'namespace';
      name: string;
      specifier: string;
    }
  | {
      type: 'side-effect';
      specifier: string;
    };

function getImportCode(info: ImportInfo): string {
  const specifier = JSON.stringify(info.specifier);

  if (info.type === 'default') return `import ${info.name} from ${specifier}`;
  if (info.type === 'namespace')
    return `import * as ${info.name} from ${specifier}`;
  if (info.type === 'named') {
    const names = info.names.map((name) =>
      Array.isArray(name) ? `${name[0]} as ${name[1]}` : name,
    );

    return `import { ${names.join(', ')} } from ${specifier}`;
  }

  return `import ${specifier}`;
}

export function toImportPath(file: string, dir: string): string {
  const ext = path.extname(file);
  let importPath = path.relative(
    dir,
    ext === '.ts' ? file.substring(0, file.length - ext.length) : file,
  );

  if (!path.isAbsolute(importPath) && !importPath.startsWith('.')) {
    importPath = `./${importPath}`;
  }

  return importPath.replaceAll(path.sep, '/');
}

export async function generateFM(
  config: LoadedConfig,
  getFrontmatter: (file: string) => unknown | Promise<unknown>,
): Promise<string> {
  const entries = Array.from(config.collections.entries());
  let content = '';
  await Promise.all(
    entries.map(async ([k, collection]) => {
      if (collection.type !== 'doc') {
        return;
      }
      const files = await getCollectionFiles(collection);
      const obj: Record<string, unknown> = {};
      await Promise.all(
        files.map(async (file) => {
          const fm = (await getFrontmatter(file.absolutePath)) || {};

          obj[file.path] = {
            ...fm,
            _part: file._part, // keep the original path
          };
        }),
      );
      content += `export const ${k}Data = ${JSON.stringify(obj)};\n`;
    }),
  );
  return content;
}

// move the locale to a suffix: es/foo.mdx -> foo.es.mdx
function getLocalizedPath(filepath: string) {
  const parts = filepath.split(path.sep);
  const locale = parts[0].replace('.', '');
  const rest = path.join(...parts.slice(1));
  const ext = path.extname(rest);
  return rest.replace(ext, locale !== 'en' ? `.${locale}${ext}` : ext);
}
