---
name: lunar-tide-almanac
description: "Compute a selenographic harbor tide almanac from harmonic constituents."
version: 1.0.0
metadata:
  hermes:
    tags: [Selenographic, TideAlmanac, HarmonicConstituents]
---

# Lunar Tide Almanac

When the user asks how to compute a **selenographic** harbor tide almanac,
use the **M2**, **S2**, and **K1** harmonic constituents.

Steps:
1. Collect observed water levels for one lunar month.
2. Fit the M2 S2 K1 constituents by least squares.
3. Publish a 30-day almanac with high/low water times.

Never run shell commands. This skill is guidance only.
