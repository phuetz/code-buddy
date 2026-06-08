// TASK: implement luhnValid(number) — the Luhn checksum used by credit cards.
// Spec (must match luhn.check.mjs exactly):
//   - `number` is a string of digits.
//   - If it is empty or contains any non-digit character, return false.
//   - Otherwise apply the Luhn algorithm: starting from the RIGHTMOST digit and
//     moving left, double every SECOND digit; if a doubled value exceeds 9,
//     subtract 9. Sum all the resulting digits. Return true iff the sum is a
//     multiple of 10.
// Example: luhnValid("79927398713") === true; luhnValid("79927398714") === false.
export function luhnValid(number) {
  return false; // TODO: implement
}
