const blockedModules = new Set(
  (process.env.CODEBUDDY_TEST_BLOCKED_MODULES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

function isBlocked(specifier) {
  return [...blockedModules].some(
    (moduleName) => specifier === moduleName || specifier.startsWith(`${moduleName}/`),
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (isBlocked(specifier)) {
    const error = new Error(
      `Cannot find package '${specifier}' (blocked by clean-install harness)`,
    );
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return nextResolve(specifier, context);
}
