// Acceptance check for slug-id.mjs. Uses the (already-implemented) slugify as
// part of the oracle, so this only passes once BOTH slugify and slugId are done
// — which is why the task graph makes slug-id depend on slugify.
import { slugId } from './slug-id.mjs';
import { slugify } from './slugify.mjs';

function ref(title, n) {
  return `${slugify(title)}-${n}`;
}

const cases = [
  ['Hello World', 7],
  ['Foo Bar', 1],
  ['  Spaces  Everywhere  ', 42],
  ['Already-Sluggish', 0],
];

let ok = true;
for (const [title, n] of cases) {
  const want = ref(title, n);
  let got;
  try {
    got = slugId(title, n);
  } catch (err) {
    console.error(`FAIL slugId(${JSON.stringify(title)}, ${n}) threw: ${err.message}`);
    ok = false;
    continue;
  }
  if (got !== want) {
    console.error(`FAIL slugId(${JSON.stringify(title)}, ${n}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    ok = false;
  }
}

console.log(ok ? 'OK slug-id (all cases pass)' : 'FAIL slug-id');
process.exit(ok ? 0 : 1);
