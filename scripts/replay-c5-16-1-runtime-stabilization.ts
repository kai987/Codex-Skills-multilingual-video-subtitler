if (!process.argv.includes("--runtime-stabilization")) {
  process.argv.splice(2, 0, "--runtime-stabilization");
}
if (!process.argv.includes("--emit-shareable-artifacts")) {
  process.argv.splice(2, 0, "--emit-shareable-artifacts");
}

await import("./replay-c5-15-overlap.js");
