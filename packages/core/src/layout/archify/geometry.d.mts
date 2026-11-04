import type { Point, Side } from "./routing.mjs";

export function roundedPath(points: Point[], radius: number): string;
export function legacyDefaultFromSide(from: { cx: number; cy: number }, to: { cx: number; cy: number }): Side;
export function legacyDefaultToSide(from: { cx: number; cy: number }, to: { cx: number; cy: number }): Side;
