import { describe, expect, it } from "vitest";
import { newClass, newDiagram, newEdge, newMember, newPackage, type Diagram } from "../src/domain/model";
import { formatCoverage, formatCrap, javaFixed, passportOf, phrase } from "../src/app/passport";
import { layoutDiagram } from "../src/layout/layout";

describe("number formats", () => {
  it("rounds half away from zero on the decimal form, like Java", () => {
    expect(javaFixed(1.15, 1)).toBe("1.2"); // toFixed(1) gives 1.1
    expect(javaFixed(2.25, 1)).toBe("2.3");
    expect(javaFixed(-2.25, 1)).toBe("-2.3");
    expect(javaFixed(-0.04, 1)).toBe("0.0");
    expect(javaFixed(3, 1)).toBe("3.0");
    expect(javaFixed(99.5, 0)).toBe("100");
    expect(javaFixed(0.125, 2)).toBe("0.13");
  });

  it("formats CRAP and coverage as umlviewer's card does", () => {
    expect(formatCrap({ mu: 14.5, max: 27.5, sigma: 10.2 })).toBe("Crap μ 14.5   max 27.5   σ 10.2");
    expect(formatCrap({ mu: 3 })).toBe("Crap μ 3.0   max 3.0   σ 0.0");
    expect(formatCrap(undefined)).toBeUndefined();
    expect(formatCoverage(0.875)).toBe("88%");
  });

  it("phrases relationships from both ends", () => {
    expect([phrase("dependency", true), phrase("dependency", false)]).toEqual(["depends on", "used by"]);
    expect(phrase("implements", false)).toBe("implemented by");
    expect(phrase("unknown", true)).toBe("to");
  });
});

describe("passport", () => {
  const cart = {
    ...newClass("domain.cart", "Cart"),
    ns: "shop.domain.cart",
    level: 0,
    crap: { mu: 2.5, max: 3, sigma: 0.5, n: 2 },
    coverage: 0.96,
    fields: [newMember("items : Item[]")],
    ops: [
      { ...newMember("add-item", "add-item"), crap: 3, cc: 3.7, coverage: 0.92, killed: 6, survived: 1, uncovered: 0, sites: 7 },
      { ...newMember("total", "total"), crap: 2, cc: 2, coverage: 1, isPrivate: true, sites: 0 },
    ],
  };
  const d: Diagram = {
    ...newDiagram("domain"),
    packages: [newPackage("view", "Domain", [cart, newClass("domain.order", "Order")])],
    edges: [newEdge("domain.order", "domain.cart", "association"), { ...newEdge("domain.cart", "domain.order", "dependency"), violating: true }],
  };
  const p = passportOf(layoutDiagram(d), "domain.cart");

  it("says who the class is", () => {
    expect(p).toMatchObject({ name: "Cart", module: "shop.domain.cart", level: 0, packageLabel: "Domain", viewTitle: "domain", crapLine: "Crap μ 2.5   max 3.0   σ 0.5" });
    expect(p?.source).toEqual({ ns: "shop.domain.cart", lang: undefined, file: undefined });
  });

  it("tabulates the class and each function", () => {
    expect(p?.stats?.cls).toMatchObject({ crap: "2.5μ", coverage: "96%", killed: 6, survived: 1, uncovered: 0, noSites: false });
    expect(p?.stats?.cls.cc).toBeUndefined();
    expect(p?.stats?.ops[0]).toMatchObject({ label: "+ add-item", name: "add-item", crap: "3.0", cc: "3", coverage: "92%", killed: 6 });
    expect(p?.stats?.ops[1]).toMatchObject({ label: "- total", isPrivate: true, noSites: true, killed: undefined });
  });

  it("lists fields and relationships from both ends", () => {
    expect(p?.fields).toEqual(["items : Item[]"]);
    expect(p?.rels).toEqual([
      { id: "domain.order", name: "Order", kind: "association", label: undefined, outgoing: false, phrase: "associated from", violating: false },
      { id: "domain.order", name: "Order", kind: "dependency", label: undefined, outgoing: true, phrase: "depends on", violating: true },
    ]);
  });

  it("names a Rust module by its file", () => {
    const rs: Diagram = { ...newDiagram("t"), packages: [newPackage("view", "t", [{ ...newClass("web", "Web"), ns: "shop::web", lang: "rust", file: "src/web.rs" }])] };
    expect(passportOf(layoutDiagram(rs), "web")?.module).toBe("web.rs");
    expect(passportOf(layoutDiagram(rs), "nope")).toBeUndefined();
  });
});
