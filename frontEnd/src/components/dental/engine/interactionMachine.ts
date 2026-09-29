/**
 * Deterministic interaction model for the 3D chart. ONE source of truth for "what mode are we in",
 * replacing scattered booleans. Every scripted camera move carries the machine's `token`; the moment a
 * new intent arrives the token changes, so a stale animation's completion is ignored (no tweens fighting).
 */
export type Mode =
  | "FULL_JAW"
  | "SELECTING_TOOTH"
  | "TOOTH_SELECTED"
  | "ENTERING_FOCUS"
  | "FOCUS"
  | "RETURNING_TO_JAW"
  | "SWITCHING_TOOTH" // a tooth is already selected and another one is chosen
  | "SWITCHING_DENTITION" // permanent / primary / mixed jaw is being swapped
  | "CAMERA_PRESET";

export type PresetName = "front" | "upper" | "lower" | "left" | "right";

export type Intent =
  | { type: "SELECT"; fdi: string }
  | { type: "FOCUS" }
  | { type: "BACK" } // also used for Reset
  | { type: "DENTITION" }
  | { type: "PRESET"; name: PresetName };

export interface Transition {
  token: number;
  kind: "select" | "focus" | "back" | "preset" | "dentition";
  mode: Mode;
  selectedFdi: string | null;
  preset?: PresetName;
}

export class InteractionMachine {
  private _mode: Mode = "FULL_JAW";
  private _selected: string | null = null;
  private _token = 0;

  get mode() { return this._mode; }
  get selectedFdi() { return this._selected; }
  get token() { return this._token; }
  get isFocusing() { return this._mode === "ENTERING_FOCUS" || this._mode === "FOCUS"; }

  /** Returns the transition to run, or null when the intent is a no-op in the current state. */
  dispatch(intent: Intent): Transition | null {
    switch (intent.type) {
      case "SELECT": {
        if (intent.fdi === this._selected && this._mode !== "FULL_JAW" && this._mode !== "RETURNING_TO_JAW" && this._mode !== "CAMERA_PRESET" && this._mode !== "SWITCHING_DENTITION") return null;
        this._mode = this._selected !== null && this._selected !== intent.fdi ? "SWITCHING_TOOTH" : "SELECTING_TOOTH";
        this._selected = intent.fdi;
        return this.make("select");
      }
      case "FOCUS": {
        if (!this._selected || this.isFocusing) return null;
        this._mode = "ENTERING_FOCUS";
        return this.make("focus");
      }
      case "BACK": {
        this._selected = null;
        this._mode = "RETURNING_TO_JAW";
        return this.make("back");
      }
      case "DENTITION": {
        this._selected = null;
        this._mode = "SWITCHING_DENTITION";
        return this.make("dentition");
      }
      case "PRESET": {
        this._mode = "CAMERA_PRESET";
        return { ...this.make("preset"), preset: intent.name };
      }
    }
  }

  /** Called when a scripted move finishes. Ignored (returns null) if it has been superseded. */
  complete(token: number): Mode | null {
    if (token !== this._token) return null;
    switch (this._mode) {
      case "SELECTING_TOOTH":
      case "SWITCHING_TOOTH": this._mode = "TOOTH_SELECTED"; break;
      case "SWITCHING_DENTITION": this._mode = "FULL_JAW"; break;
      case "ENTERING_FOCUS": this._mode = "FOCUS"; break;
      case "RETURNING_TO_JAW": this._mode = "FULL_JAW"; break;
      case "CAMERA_PRESET": this._mode = this._selected ? "TOOTH_SELECTED" : "FULL_JAW"; break;
      default: return null;
    }
    return this._mode;
  }

  private make(kind: Transition["kind"]): Transition {
    this._token += 1;
    return { token: this._token, kind, mode: this._mode, selectedFdi: this._selected };
  }
}
