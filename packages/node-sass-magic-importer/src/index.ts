// TODO: add all tests from current projects
// TODO: Resolve todos in other pacakges
// TODO: refactor
// TODO: cleanup (unused dependencies / functins / interfaces / ...)

import * as cssNodeExtract from 'css-node-extract';
import * as cssSelectorExtract from 'css-selector-extract';
import * as fs from 'fs';
import * as getInstalledPath from 'get-installed-path';
import * as hash from 'object-hash';
import * as path from 'path';
import * as postcssSyntax from 'postcss-scss';

import { defaultOptions } from './default-options';
import {
  buildIncludePaths,
  cleanImportUrl,
  parseNodeFilters,
  parseSelectorFilters,
  resolveGlobUrl,
  resolvePackageUrl,
  resolveUrl,
  sassGlobPattern,
} from './toolbox';

import { IMagicImporterOptions } from './interfaces/IImporterOptions';
import { ISelectorFilter } from './interfaces/ISelectorFilter';

const EMPTY_IMPORT = {
  file: ``,
  contents: ``,
};
const DIRECTORY_SEPARATOR = `/`;

function getStoreId(
  resolvedUrl: string|null,
  selectorFilters: ISelectorFilter[]|null = null,
  nodeFilters: string[]|null = null,
) {
  return hash({
    resolvedUrl,
    selectorFilters,
    nodeFilters,
  }, { unorderedArrays: true });
}

export = function magicImporter(userOptions?: IMagicImporterOptions) {
  const options = Object.assign({}, defaultOptions, userOptions);

  if (options.hasOwnProperty(`prefix`)) {
    process.emitWarning('Using the `prefix` option is not supported anymore, use `packagePrefix` instead.');
  }

  const escapedPrefix = options.packagePrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, `\\$&`);
  const matchPackageUrl = new RegExp(`^${escapedPrefix}(?!/)`);

  return function importer(url: string, prev: string) {
    const nodeSassOptions = this.options;

    // Create a context for the current importer run.
    // An importer run is different from an importer instance,
    // one importer instance can spawn infinite importer runs.
    if (!this.nodeSassOnceImporterContext) {
      this.nodeSassOnceImporterContext = { store: new Set() };
    }

    // Each importer run has it's own new store, otherwise
    // files already imported in a previous importer run
    // would be detected as multiple imports of the same file.
    const store = this.nodeSassOnceImporterContext.store;
    const includePaths = buildIncludePaths(
      nodeSassOptions.includePaths,
      prev,
    );

    let data = null;
    let filterPrefix: string = ``;
    let filteredContents: string|null = null;
    let cleanedUrl = cleanImportUrl(url);
    let resolvedUrl: string|null = null;
    const isPackageUrl = cleanedUrl.match(matchPackageUrl);

    if (isPackageUrl) {
      cleanedUrl = cleanedUrl.replace(matchPackageUrl, ``);

      const packageName = cleanedUrl.split(DIRECTORY_SEPARATOR)[0];
      const packagePath = getInstalledPath.sync(packageName, {
        cwd: options.cwd,
        local: true,
      });

      cleanedUrl = path.resolve(path.dirname(packagePath), cleanedUrl);

      resolvedUrl = resolvePackageUrl(
        cleanedUrl,
        options.extensions,
        options.cwd,
        options.packageKeys,
      );

      if (resolvedUrl) {
        data = { file: resolvedUrl };
      }
    } else {
      resolvedUrl = resolveUrl(cleanedUrl, includePaths);
    }

    const nodeFilters = parseNodeFilters(url);
    const selectorFilters = parseSelectorFilters(url);
    const hasFilters = nodeFilters.length || selectorFilters.length;
    const globFilePaths = resolveGlobUrl(cleanedUrl, includePaths);
    const storeId = getStoreId(resolvedUrl, selectorFilters, nodeFilters);

    if (hasFilters) {
      filterPrefix = `${url.split(` from `)[0]} from `;
    }

    if (globFilePaths.length) {
      const contents = globFilePaths
        .filter((x) => !store.has(getStoreId(x, selectorFilters, nodeFilters)))
        .map((x) => `@import '${filterPrefix}${x}';`)
        .join(`\n`);

      return { contents };
    }

    if (store.has(storeId)) {
      return EMPTY_IMPORT;
    }

    if (resolvedUrl && hasFilters) {
      filteredContents = fs.readFileSync(resolvedUrl, { encoding: `utf8` });

      if (selectorFilters.length) {
        filteredContents = cssSelectorExtract.processSync({
          css: filteredContents,
          filters: selectorFilters,
          postcssSyntax,
        });
      }

      if (nodeFilters.length) {
        filteredContents = cssNodeExtract.processSync({
          css: filteredContents,
          filters: nodeFilters,
          postcssSyntax,
        });
      }
    }

    if (!options.disableImportOnce) {
      store.add(storeId);
    }

    if (filteredContents) {
      data = {
        file: resolvedUrl,
        contents: filteredContents,
      };
    }

    return data;
  };
};
