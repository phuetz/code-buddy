# MySoulmate image prompt catalog

This catalog turns public companion-product patterns into original MySoulmate
image moments. It does not copy competitor characters, private prompts, or
visual assets.

The normative image and video acceptance criteria live in
[`docs/mysoulmate-visual-quality-requirements.md`](mysoulmate-visual-quality-requirements.md).
In particular, public fashion references are used only as visual grammar. Their
pixels, identities, and distinctive scenes must not enter Lisa's LoRA dataset or
be reproduced as shots.

## Public product patterns reviewed

- [Replika](https://help.replika.com/hc/en-us/articles/360032500052-What-is-Replika-Pro)
  presents romantic and creative selfies as relationship moments, including
  images sent proactively.
- [Nomi](https://wiki.nomi.ai/Get_Started%3A_Nomi_Selfies) treats the current
  conversation as the image prompt: what the companion is doing, wearing, and
  feeling should carry into the selfie.
- [Kindroid](https://kindroid.ai/docs/article/palette-v6-selfies-guide/) recommends
  concise natural language ordered by identity, action, setting, clothing,
  camera, lighting, and mood. Its current guidance also separates the stable
  avatar identity from the scene-specific selfie prompt.
- [Candy AI](https://candy.ai/ai-image-generator) exposes direct control over
  outfit, pose, action, appearance, realistic/anime rendering, and multiple
  variants.

## MySoulmate implementation

`src/companion/mysoulmate-image-prompts.ts` contains 24 original moments: two
for each Lisa style. Each moment stores:

1. action or pose;
2. one coherent location;
3. separate `safe` and covered `sensual` outfits;
4. framing and camera intent;
5. lighting;
6. emotional mood.

The current families are:

| Style | Moments |
|---|---|
| `studio` | Studio confidence, Soft studio profile |
| `wet-selfie` | Rainy window selfie, After-rain mirror |
| `street-rain` | Paris rain walk, Umbrella café |
| `neon-skate` | Neon skate night, Neon arcade |
| `soft-editorial` | Gallery afternoon, Bookshop discovery |
| `tender` | Morning coffee, Couch reading |
| `playful` | Flower market, Kitchen dance |
| `bold` | Date night, Rooftop evening |
| `sparkly` | Birthday lights, Winter lights |
| `calm` | Sunset balcony, Quiet window tea |
| `mika` | Urban adventure, Weekend hike |
| `portrait` | Natural phone selfie, Timeless portrait |

The cache generator records `momentId`, `momentTitle`, and `momentCategory` in
each JSON sidecar. It also appends anti-collage constraints after the structured
prompt.

## Content tiers

- `safe`: everyday, romantic, creative, celebration, adventure, and wellbeing
  moments.
- `sensual`: the same coherent moments with adult, tasteful, fully covered
  styling.
- `explicit`: intentionally absent from this catalog. Even with the general
  adult feature flag enabled, generation requires a separate policy-approved
  prompt provider, age verification, consent controls, moderation, and audit
  logs.

For video pilots, the covered `sensual` tier may use original fashion actions
such as a slow walk, a three-quarter weight shift, a controlled turn with an
over-the-shoulder look, realistic dress movement, a staircase walk, or a stable
handbag interaction. These actions are targets for future catalog expansion,
not claims that the current 24 image moments already implement video motion.

Existing cached images are never overwritten automatically. To deliberately
regenerate a tier with the new catalog:

```bash
buddy lora selfie-cache --tier safe --per-style 2 --no-resume
buddy lora selfie-cache --tier sensual --per-style 2 --no-resume
```
