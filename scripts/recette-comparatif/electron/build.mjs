// Runs the private Vite build with cwd = cowork (Tailwind/PostCSS resolve from cwd).
if (!process.env.RECETTE_WORKTREE || !process.env.RECETTE_ELECTRON_DIR) throw new Error('set RECETTE_WORKTREE (repo under test) and RECETTE_ELECTRON_DIR (private output dir)');
const cowork = `${process.env.RECETTE_WORKTREE}/cowork`;
process.chdir(cowork);
process.env.NODE_ENV = 'production';
const { build } = await import(`${cowork}/node_modules/vite/dist/node/index.js`);
await build({ configFile: `${process.env.RECETTE_ELECTRON_DIR}/vite.e2e.config.mjs`, configLoader: 'native', mode: 'production' });
console.log('BUILD-OK');
