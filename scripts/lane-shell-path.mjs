/** Paths printed to Git Bash must use its /c/... spelling, not native C:\\.... */
export function toBashPath(file, platform = process.platform) {
  if (platform !== 'win32') return file;
  return file.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}
