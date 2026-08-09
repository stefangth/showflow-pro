/**
 * The single onboarding surface a module page shows right now.
 * - "banner"    the full setup wizard (incomplete, not collapsed)
 * - "collapsed" the compact progress bar the wizard collapses into (incomplete, hidden)
 * - "button"    the permanent "Setup checklist" header button (setup complete)
 * - "hidden"    nothing (loading, not entitled, or nothing this viewer can act on)
 * See docs/superpowers/specs/2026-08-09-module-onboarding-collapse-to-bar-design.md.
 */
export type SetupRailMode = "banner" | "collapsed" | "button" | "hidden";
