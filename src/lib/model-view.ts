import type { ModelView } from "../../skills/sprue/pipeline/model.ts";

/** The view Fig 1's 3D tab draws on the site (WorkedExample.tsx), from the model.json copy-figures wrote on this build.
 * The build has no pcb/ (git ignores it), so the keypad's check, run on the board's zip, reads as of an earlier design
 * there. When the gate record says `sprue inspect` found system.json of the files (RunView.model.current), it isn't
 * said to be: its stale and missing are none, as the page's Inspect takes the record's verdict. */
export function siteModelView(view: ModelView, current: boolean): ModelView {
  return current ? { ...view, stale: [], missing: [] } : view;
}
