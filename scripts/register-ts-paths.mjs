import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = process.cwd();

function tryResolve(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.json`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!path.extname(specifier) && !specifier.startsWith(".") && !specifier.startsWith("/") && specifier.includes("/")) {
      const resolved = tryResolve(path.join(projectRoot, "node_modules", specifier));
      if (resolved) {
        return {
          shortCircuit: true,
          url: resolved,
        };
      }
    }

    if (specifier.startsWith("@/")) {
      const resolved = tryResolve(path.join(projectRoot, "src", specifier.slice(2)));
      if (resolved) {
        return {
          shortCircuit: true,
          url: resolved,
        };
      }
    }

    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const parentPath = fileURLToPath(context.parentURL);
      const resolved = tryResolve(path.resolve(path.dirname(parentPath), specifier));
      if (resolved) {
        return {
          shortCircuit: true,
          url: resolved,
        };
      }
    }

    return nextResolve(specifier, context);
  },
});
