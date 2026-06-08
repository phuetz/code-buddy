// Acceptance check for slugify.mjs. Exits 0 if the implementation matches the
// reference on every case, else 1. The expected values come from a correct
// reference implementation (the oracle), so ANY correct slugify passes — the
// agent is not pinned to one particular coding style.
import { slugify } from './slugify.mjs';

function ref(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const inputs = [
  'Hello World',
  '  Hello,  World! ',
  'Foo_Bar Baz',
  'Multiple   Spaces',
  'Special!@#Chars',
  'already-a-slug',
  'CamelCase123',
  '   ',
];

let ok = true;
for (const input of inputs) {
  const want = ref(input);
  let got;
  try {
    got = slugify(input);
  } catch (err) {
    console.error(`FAIL slugify(${JSON.stringify(input)}) threw: ${err.message}`);
    ok = false;
    continue;
  }
  if (got !== want) {
    console.error(`FAIL slugify(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    ok = false;
  }
}

console.log(ok ? 'OK slugify (all cases pass)' : 'FAIL slugify');
process.exit(ok ? 0 : 1);
