import * as path from 'node:path';
import * as fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import grayMatter from 'gray-matter';
import { getConfigHash, loadConfigCached } from '@/config/cached';
import { generateJS, generateTypes } from '@/map/generate';
import { writeManifest } from '@/map/manifest';
import { LoadedConfig } from '@/config/load';

/**
 * Start a MDX server that builds index and manifest files.
 *
 * In development mode, it starts a file watcher to auto-update output as your input changes.
 */
export async function start(
  dev: boolean,
  configPath: string,
  outDir: string,
): Promise<void> {
  let configHash = await getConfigHash(configPath);
  let config = await loadConfigCached(configPath, configHash);
  const manifestPath = path.resolve(outDir, 'manifest.json');

  const frontmatterCache = new Map<string, unknown>();
  let hookUpdate = false;

  // TODO: Stream and read only the header
  const readFrontmatter = async (file: string): Promise<unknown> => {
    const cached = frontmatterCache.get(file);
    if (cached) return cached;
    hookUpdate = true;

    return grayMatter({
      content: await readFile(file).then((res) => res.toString()),
    }).data;
  };

  fs.mkdirSync(outDir, { recursive: true });

  let outputGroups = toOutputGroups(config);
  await writeJS(outputGroups, outDir, configPath, configHash, readFrontmatter);
  await writeTypes(outputGroups, outDir, configPath);

  console.log('[MDX] initialized map file');

  if (dev) {
    const { watcher } = await import('@/map/watcher');
    const instance = watcher(configPath, config);

    instance.on('ready', () => {
      console.log('[MDX] started dev server');
    });

    instance.on('all', (event, file) => {
      if (typeof file !== 'string') return;

      const onUpdate = async (): Promise<void> => {
        const isConfigFile = path.resolve(file) === configPath;

        if (isConfigFile) {
          configHash = await getConfigHash(configPath);
          config = await loadConfigCached(configPath, configHash);
          outputGroups = toOutputGroups(config);
          await writeTypes(outputGroups, outDir, configPath);
          console.log('[MDX] Updated map types');
        }

        if (isConfigFile || event !== 'change' || hookUpdate) {
          if (event === 'change') frontmatterCache.delete(file);

          await writeJS(
            outputGroups,
            outDir,
            configPath,
            configHash,
            readFrontmatter,
          );

          console.log('[MDX] Updated map file');
        }
      };

      void onUpdate();
    });

    process.on('exit', () => {
      console.log('[MDX] closing dev server');
      void instance.close();
    });
  }

  if (config.global?.generateManifest && !dev) {
    process.on('exit', () => {
      console.log('[MDX] writing manifest');
      writeManifest(manifestPath, config);
    });
  }
}

function toOutputGroups(config: LoadedConfig) {
  const outputGroups: Record<string, LoadedConfig> = {};
  for (const [k, v] of config.collections.entries()) {
    let output = v.output ?? 'index';
    if (!outputGroups[output]) {
      outputGroups[output] = { ...config, collections: new Map() };
    }
    outputGroups[output].collections.set(k, v);
  }
  return outputGroups;
}

async function writeJS(
  outputGroups: Record<string, LoadedConfig>,
  outDir: string,
  configPath: string,
  configHash: string,
  readFrontmatter: (file: string) => Promise<unknown>,
) {
  await Promise.all(
    Object.entries(outputGroups).map(async ([fileName, config]) => {
      const jsOut = path.resolve(outDir, `${fileName}.js`);
      const jsContent = await generateJS(
        configPath,
        config,
        jsOut,
        configHash,
        readFrontmatter,
      );
      await writeFile(jsOut, jsContent);
    }),
  );
}

async function writeTypes(
  outputGroups: Record<string, LoadedConfig>,
  outDir: string,
  configPath: string,
) {
  await Promise.all(
    Object.entries(outputGroups).map(async ([fileName, config]) => {
      const typeOut = path.resolve(outDir, `${fileName}.d.ts`);
      const typeContent = generateTypes(configPath, config, typeOut);
      await writeFile(typeOut, typeContent);
    }),
  );
}
