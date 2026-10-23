// C5.16 uses the shared collision-safe overlap replay implementation with
// explicit mapped-token/runtime options. Keeping one execution path prevents
// the C5.15.1 compatibility replay and C5.16 evidence replay from drifting.
await import("./replay-c5-15-overlap.js");
