// TASK: implement slugId(title, n).
// It must return the slug of `title` (reuse the slugify() exported from
// ./slugify.mjs — DO NOT reimplement it) followed by a hyphen and the number n.
// Spec (must match slug-id.check.mjs exactly):
//   slugId("Hello World", 7) === "hello-world-7"
// This task DEPENDS on the slugify task being done first (it imports slugify).
import { slugify } from './slugify.mjs';

export function slugId(title, n) {
  return String(title); // TODO: implement using slugify(title)
}
