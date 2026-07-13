# Local meal safety engine

This directory is intentionally independent from the general user/persona
model. `FoodProfile` contains only explicit food constraints and their
provenance. The engine does not diagnose, infer an allergy from an ingredient
name, create a therapeutic target, or modify a clinician-provided rule.

## Storage policy

Profiles are always encrypted with AES-256-GCM and authenticated envelope
metadata. `CODEBUDDY_LIFE_ENCRYPTION_KEY` is preferred and is expanded to a
32-byte key with scrypt and a random per-save salt.

When the environment key is absent, the store creates a cryptographically
random local secret at `~/.codebuddy/life/meals.key`. The directory is forced
to mode `0700`, the key and encrypted profile to `0600`, symbolic-link key or
profile files are rejected, and writes are atomic. There is deliberately no
plaintext or machine-identity fallback. If the local key is lost, loading
fails closed instead of silently creating a replacement key.

The paths and key source can be overridden through `FoodProfileStoreOptions`
for isolated tests. An existing envelope always records its key source, so a
local key is never substituted for a missing environment secret.

## Allergen policy

The 14 EU allergen categories use canonical ids from `allergens.ts`. A recipe
ingredient without an explicit `known` disclosure remains `unknown`; an empty
`known.contains` list is therefore materially different from missing data.
Any substitution is normalized and checked against the complete recipe again.
The suggestion API only emits recipes with an explicit `compatible` verdict.

## Plans and inventory

`MealPlanStore` and `FoodInventoryStore` keep operational household data in
private atomic JSON files (`0700` directory and `0600` file on POSIX). They do
not copy profile constraints or clinician data; those remain exclusively in
the encrypted `FoodProfileStore`.

A plan entry always receives an explicit local date, `HH:mm` wall time, IANA
timezone and meal slot. `nextUpcoming()` reuses the life-rhythm DST policy:
spring-gap minutes move to the first valid minute, and an autumn-fold minute
uses its first occurrence. The store never manufactures a date or default
timezone.

Inventory expiration is equally explicit: `availableUntil` must contain `Z`
or a UTC offset. No shelf life or allergen is inferred from the food name.
Expired items remain auditable in storage but are omitted by `listActive()`.
