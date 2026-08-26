const Module = require('node:module');

const blockedModules = new Set(
  (process.env.CODEBUDDY_TEST_BLOCKED_MODULES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);
const originalLoad = Module._load;

Module._load = function loadWithOptionalDependencyIsolation(request, parent, isMain) {
  const blocked = [...blockedModules].some(
    (moduleName) => request === moduleName || request.startsWith(`${moduleName}/`),
  );
  if (blocked) {
    const error = new Error(
      `Cannot find module '${request}' (blocked by clean-install harness)`,
    );
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return originalLoad.call(this, request, parent, isMain);
};
