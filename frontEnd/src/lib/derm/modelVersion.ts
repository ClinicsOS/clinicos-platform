/**
 * Visual-model version of the Dermatology & Aesthetics 3D human.
 *
 * This is VISUAL / MAPPING metadata only. It identifies which artwork is drawn; it is never part of a region id and is
 * never stored in (or migrated for) any clinical record: assessments, diagnoses, treatments, sessions, follow-ups,
 * history and timeline events all point at the stable registry region ids, which do not depend on the artwork.
 *
 *  "1" — the procedural development mannequin (bodyBuilder.ts, now only the emergency fallback).
 *  "2" — the generated smooth-skin clinical human (superseded).
 *  "3" — the generated superficial-anatomy (atlas-style muscle / tendon / bone colouring) human
 *        (scripts/derm-human -> public/models/derm/{male,female}.glb).
 */
export const DERM_HUMAN_MODEL_VERSION = "3";
/** The artwork id written into manifest.json (`modelVersion`) for this visual version. */
export const DERM_HUMAN_ASSET_VERSION = `derm-human-v${DERM_HUMAN_MODEL_VERSION}`;
/** Id reported by the emergency (procedural) fallback body. */
export const DERM_FALLBACK_ASSET_VERSION = "derm-procedural-fallback-v1";
