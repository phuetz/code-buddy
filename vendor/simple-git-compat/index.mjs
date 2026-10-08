// simple-git 4.x n'a plus d'export par defaut ; node-llama-cpp 3.x fait encore
// `import simpleGit from "simple-git"`. On rend les deux formes disponibles.
import { simpleGit } from 'simple-git-v4';
export * from 'simple-git-v4';
export { simpleGit };
export default simpleGit;
