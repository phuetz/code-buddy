// Acceptance check for luhn.mjs. The reference implementation is the oracle, so
// any correct Luhn passes. Exits 0 on success, 1 on failure.
import { luhnValid } from './luhn.mjs';

function ref(num) {
  if (typeof num !== 'string' || !/^\d+$/.test(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const inputs = [
  '79927398713',     // classic valid
  '79927398714',     // invalid (wrong check digit)
  '4539148803436467',// 16-digit
  '1234567812345678',
  '1111111111111111',
  '0',
  '',                // empty -> false
  '12a4',            // non-digit -> false
];

let ok = true;
for (const n of inputs) {
  const want = ref(n);
  let got;
  try {
    got = luhnValid(n);
  } catch (err) {
    console.error(`FAIL luhnValid(${JSON.stringify(n)}) threw: ${err.message}`);
    ok = false;
    continue;
  }
  if (got !== want) {
    console.error(`FAIL luhnValid(${JSON.stringify(n)}) = ${got}, want ${want}`);
    ok = false;
  }
}

console.log(ok ? 'OK luhn (all cases pass)' : 'FAIL luhn');
process.exit(ok ? 0 : 1);
