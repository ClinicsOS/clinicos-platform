import type { CameraState, Facing, ViewMode } from "./types";

/**
 * Deterministic interaction model for the 3D clinical map. ONE source of truth for "what is the camera doing".
 * Every scripted camera move carries the machine's `token`; the moment a new intent arrives the token changes, so a
 * stale animation's completion is ignored (no tweens fighting, no half-applied states after rapid clicks).
 *
 * States: BODY_OVERVIEW | FACE_OVERVIEW | SCALP_OVERVIEW | REGION_FOCUS | RESETTING
 * A scripted move is "in flight" from dispatch until `complete(token)`; while in flight `state` is the TARGET state.
 */
export type Intent =
  | { type: "VIEW"; view: ViewMode }
  | { type: "FACE"; facing: Facing }
  | { type: "FOCUS"; regionId: string }
  | { type: "RESET" }
  | { type: "ENTER"; view: ViewMode };

export interface Transition {
  token: number;
  kind: "view" | "facing" | "focus" | "reset" | "enter";
  state: CameraState;
  view: ViewMode;
  facing: Facing;
  /** Region the camera is (or is moving to) focused on; null when not in REGION_FOCUS. */
  focusRegionId: string | null;
}

const OVERVIEW: Record<ViewMode, CameraState> = {
  body: "BODY_OVERVIEW",
  face: "FACE_OVERVIEW",
  scalp: "SCALP_OVERVIEW",
};

export class InteractionMachine {
  private _state: CameraState = "BODY_OVERVIEW";
  private _view: ViewMode = "body";
  private _facing: Facing = "front";
  private _focus: string | null = null;
  private _token = 0;
  private _inFlight = false;

  get state() { return this._state; }
  get view() { return this._view; }
  get facing() { return this._facing; }
  get focusRegionId() { return this._focus; }
  get token() { return this._token; }
  get inFlight() { return this._inFlight; }

  dispatch(intent: Intent): Transition | null {
    switch (intent.type) {
      case "ENTER": {
        // initial mount / model swap: always runs, supersedes everything
        this._view = intent.view;
        this._focus = null;
        this._facing = "front";
        this._state = OVERVIEW[intent.view];
        return this.make("enter");
      }
      case "VIEW": {
        if (!this._inFlight && this._view === intent.view && this._focus === null && this._facing === "front") return null;
        this._view = intent.view;
        this._focus = null;
        this._facing = "front";
        this._state = OVERVIEW[intent.view];
        return this.make("view");
      }
      case "FACE": {
        // rotate around the subject without leaving the current view; clears a region focus (the user asked for a side)
        if (!this._inFlight && this._focus === null && this._facing === intent.facing) return null;
        this._facing = intent.facing;
        this._focus = null;
        this._state = OVERVIEW[this._view];
        return this.make("facing");
      }
      case "FOCUS": {
        if (!this._inFlight && this._focus === intent.regionId) return null;
        this._focus = intent.regionId;
        this._state = "REGION_FOCUS";
        return this.make("focus");
      }
      case "RESET": {
        this._focus = null;
        this._facing = "front";
        this._state = "RESETTING";
        return this.make("reset");
      }
    }
  }

  /** Called when a scripted move finishes. Ignored (returns null) when it has been superseded by a newer intent. */
  complete(token: number): CameraState | null {
    if (token !== this._token) return null;
    this._inFlight = false;
    if (this._state === "RESETTING") this._state = OVERVIEW[this._view];
    return this._state;
  }

  /** The user grabbed the camera (orbit/zoom/pan) — a scripted move is cancelled by the engine; settle the state. */
  interrupt(): CameraState {
    this._token += 1; // invalidates any in-flight completion
    this._inFlight = false;
    if (this._state === "RESETTING") this._state = OVERVIEW[this._view];
    return this._state;
  }

  private make(kind: Transition["kind"]): Transition {
    this._token += 1;
    this._inFlight = true;
    return { token: this._token, kind, state: this._state, view: this._view, facing: this._facing, focusRegionId: this._focus };
  }
}
