# derm-human — generator of the Dermatology & Aesthetics clinical human (visual model v3, superficial anatomy)

Offline, dependency-light generator that produces `frontEnd/public/models/derm/male.glb` and `female.glb` and rewrites
`manifest.json`. **The app never runs this folder**: it ships the generated files. Nothing here downloads or uses any third-party
model, scan or texture.

## Pipeline
| File | Role |
|---|---|
| `sdf.js` | signed-distance primitives + smooth union / carve |
| `muscles.js` | superficial muscle / tendon / bone TERRITORIES: sculpt bellies + grooves into the skin and drive the atlas colours (visual only, never clinical ids) |
| `human.js` | the anatomy (head/face/ears, torso, neck, arms, hands, legs, feet) for MALE and FEMALE, blended into ONE skin |
| `mesher.js` | sparse surface nets over the SDF |
| `refine.js` | conforming local refinement (face: eyes, lips, nose, ears) with midpoints projected onto the true surface |
| `finalize.js` | simplification (meshoptimizer), SDF normals, baked ambient occlusion |
| `color.js` | vertex colours: atlas palette from `muscles.js` + eyes. Colour never encodes disease / severity / diagnosis |
| `regions.js` | clinical hit layer: every triangle -> ONE registry region id, using the shared rules in `engine/regionRules.ts` |
| `glb.js` | minimal glTF 2.0 binary writer (`skin` + hidden `hit_<id>` meshes) |
| `generate.js` | runs everything, writes the GLBs + manifest |

Frame: `+X` = patient LEFT, `+Y` up, `+Z` anterior, metres, origin on the floor. Sides are built for the left and mirrored,
and the loader additionally rejects a mirrored asset.

## Regenerate (dev machine only)
```
cd scripts/derm-human
npm i --no-save meshoptimizer          # dev-only (simplifier); NOT added to the app's package.json
cd ../..
node scripts/derm-human/generate.js all --h 0.003 --tris 105000
```
Takes about 1–2 minutes per model. Output is deterministic for the same code. Then `node scripts/check-derm-registry-sync.js`.
