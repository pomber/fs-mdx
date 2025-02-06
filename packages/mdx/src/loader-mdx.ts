import * as path from 'node:path';
import { parse } from 'node:querystring';
import grayMatter from 'gray-matter';
import { type LoaderContext } from 'webpack';
import { getConfigHash, loadConfigCached } from '@/utils/config-cache';
import { buildMDX } from '@/utils/build-mdx';
import { formatError } from '@/utils/format-error';
import { getGitTimestamp } from './utils/git-timestamp';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface Options {
  /**
   * @internal
   */
  _ctx: {
    configPath: string;
  };
}

function parseQuery(query: string): {
  collection?: string;
  hash?: string;
} {
  let collection: string | undefined;
  let hash: string | undefined;
  const parsed = parse(query.slice(1));

  if (parsed.collection && typeof parsed.collection === 'string')
    collection = parsed.collection;

  if (parsed.hash && typeof parsed.hash === 'string') hash = parsed.hash;

  return { collection, hash };
}

/**
 * Load MDX/markdown files
 *
 * it supports frontmatter by parsing and injecting the data in `vfile.data.frontmatter`
 */
export default async function loader(
  this: LoaderContext<Options>,
  source: string,
  callback: LoaderContext<Options>['callback'],
): Promise<void> {
  this.cacheable(true);
  const context = this.context;
  const filePath = this.resourcePath;
  const { _ctx } = this.getOptions();
  const matter = grayMatter(source);

  // notice that `resourceQuery` can be missing (e.g. `page.mdx`)
  const {
    hash: configHash = await getConfigHash(_ctx.configPath),
    collection: collectionId,
  } = parseQuery(this.resourceQuery);
  const config = await loadConfigCached(_ctx.configPath, configHash);

  let collection =
    collectionId !== undefined
      ? config.collections.get(collectionId)
      : undefined;

  if (collection && collection.type === 'docs') collection = collection.docs;
  if (collection && collection.type !== 'doc') {
    collection = undefined;
  }

  const mdxOptions =
    collection?.mdxOptions ?? (await config.getDefaultMDXOptions());

  if (collection?.schema) {
    let schema = collection.schema;

    if (typeof schema === 'function' && !('~standard' in schema)) {
      schema = schema({
        async buildMDX(v, options = mdxOptions) {
          const res = await buildMDX(
            collectionId ?? 'global',
            configHash,
            v,
            options,
          );
          return String(res.value);
        },
        source,
        path: filePath,
      });
    }

    if ('~standard' in schema) {
      const result = await (schema as StandardSchemaV1)['~standard'].validate(
        matter.data,
      );
      if (result.issues) {
        callback(
          new Error(
            formatError(`invalid frontmatter in ${filePath}:`, result.issues),
          ),
        );
        return;
      }

      matter.data = result.value as Record<string, unknown>;
    }
  }

  let timestamp: number | undefined;
  if (config.global?.lastModifiedTime === 'git')
    timestamp = (await getGitTimestamp(filePath))?.getTime();

  try {
    // ensure the line number is correct in dev mode
    const lineOffset = '\n'.repeat(
      this.mode === 'development' ? lines(source) - lines(matter.content) : 0,
    );

    const file = await buildMDX(
      collectionId ?? 'global',
      configHash,
      lineOffset + matter.content,
      {
        development: this.mode === 'development',
        ...mdxOptions,
        filePath,
        frontmatter: matter.data,
        data: {
          lastModified: timestamp,
        },
        _compiler: this,
      },
    );

    callback(undefined, String(file.value), file.map ?? undefined);
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    const fpath = path.relative(context, filePath);
    error.message = `${fpath}:${error.name}: ${error.message}`;
    callback(error);
  }
}

function lines(s: string) {
  let num = 0;

  for (const c of s) {
    if (c === '\n') num++;
  }

  return num;
}
