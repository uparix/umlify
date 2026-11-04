import { describe, expect, it } from "vitest";
import { ednDiff } from "./support/edn-diff";
import { recordedCalls, run } from "./support/replay";

// Every call the Clojure domain specs made, replayed against the port
// (umlviewer DomainReplayTests). The layout engine and the canvas-drawn
// class card (detail) are not ported: umlify lays out and draws its own.
describe.each(["config", "ir", "policy", "hierarchy", "overlay", "source", "source-clojure", "source-rust"])("replayed %s calls", (ns) => {
  it("match the Clojure results", () => {
    const calls = recordedCalls(ns);
    expect(calls.length).toBeGreaterThan(0);
    const failures: string[] = [];
    calls.forEach((call, i) => {
      if (call.throws) {
        try {
          run(call);
          failures.push(`#${i} ${call.fn} should throw`);
        } catch {
          // expected
        }
        return;
      }
      try {
        const diffs = ednDiff(call.expected, run(call));
        if (diffs.length > 0) failures.push(`#${i} ${call.fn}: ${diffs.slice(0, 5).join("; ")}`);
      } catch (e) {
        failures.push(`#${i} ${call.fn}: ${String(e)}`);
      }
    });
    expect(failures, `${failures.length} of ${calls.length} calls differ:\n${failures.slice(0, 20).join("\n")}`).toEqual([]);
  });
});
