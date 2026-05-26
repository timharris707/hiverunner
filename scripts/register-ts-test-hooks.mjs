import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const ts = require("typescript");

const projectRoot = process.cwd();
const tsExtensions = [".ts", ".tsx", ".mts", ".cts"];
const jsExtensions = [".js", ".jsx", ".mjs", ".cjs", ".json"];

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  esModuleInterop: true,
  jsx: ts.JsxEmit.ReactJSX,
  resolveJsonModule: true,
  isolatedModules: true,
  inlineSourceMap: true,
  inlineSources: true,
};

const formatHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => projectRoot,
  getNewLine: () => "\n",
};

function tryResolve(basePath) {
  const candidates = [
    basePath,
    ...tsExtensions.map((extension) => `${basePath}${extension}`),
    ...jsExtensions.map((extension) => `${basePath}${extension}`),
    ...tsExtensions.map((extension) => path.join(basePath, `index${extension}`)),
    ...jsExtensions.map((extension) => path.join(basePath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function resolveAlias(request) {
  if (!request.startsWith("@/")) {
    return null;
  }

  return tryResolve(path.join(projectRoot, "src", request.slice(2)));
}

function transpile(filename, source) {
  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, formatHost));
  }

  return result.outputText;
}

const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

for (const extension of tsExtensions) {
  Module._extensions[extension] ??= Module._extensions[".js"];
}

Module._resolveFilename = function resolveTsTestFilename(request, parent, isMain, options) {
  const resolvedAlias = resolveAlias(request);
  if (resolvedAlias) {
    return resolvedAlias;
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function loadTsTestModule(request, parent, isMain) {
  const resolvedFilename = Module._resolveFilename(request, parent, isMain);
  const filename =
    typeof resolvedFilename === "string" && resolvedFilename.startsWith("file:")
      ? fileURLToPath(resolvedFilename)
      : resolvedFilename;
  if (tsExtensions.includes(path.extname(filename))) {
    return loadTypeScriptModule(filename, parent, isMain);
  }

  return originalLoad.call(this, request, parent, isMain);
};

function loadTypeScriptModule(filename, parent, isMain) {
  const cachedModule = Module._cache[filename];
  if (cachedModule) {
    return cachedModule.exports;
  }

  const module = new Module(filename, parent);
  Module._cache[filename] = module;
  module.filename = `${filename}.cjs`;
  module.paths = Module._nodeModulePaths(path.dirname(filename));

  if (parent?.children && !parent.children.includes(module)) {
    parent.children.push(module);
  }

  let threw = true;
  try {
    compileCommonJs(module, filename, transpile(filename, readFileSync(filename, "utf8")));
    threw = false;
  } finally {
    if (threw) {
      delete Module._cache[filename];
    }
  }

  module.loaded = true;
  if (isMain) {
    process.mainModule = module;
  }

  return module.exports;
}

function compileCommonJs(module, filename, source) {
  const wrapper = vm.runInThisContext(Module.wrap(source), {
    filename: `${filename}.cjs`,
    displayErrors: true,
  });

  wrapper.call(
    module.exports,
    module.exports,
    module.require.bind(module),
    module,
    filename,
    path.dirname(filename),
  );
}
