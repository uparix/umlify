import { describe, expect, it } from "vitest";
import { clojureExtractMember, javaMemberPath, locateMember, rustExtractMember, sourceCandidates } from "../src/app/source";

// Port of umlviewer's SourceTests, split into "which file" and "which line"
// because the browser reads files through the server.
describe("source lookup", () => {
  it("finds a Clojure defn under src by namespace", () => {
    const text = '(ns demo-app.core)\n\n(defn- helper [x] x)\n\n(defn go\n  [x]\n  (helper "(" x))\n';
    expect(sourceCandidates({ ns: "demo-app.core" })).toEqual(["src/demo_app/core.clj", "src/demo_app/core.cljc", "src/demo_app/core.cljs"]);
    expect(locateMember(text, { ns: "demo-app.core", name: "go" })).toEqual({ found: true, line: 5 });
    expect(clojureExtractMember(text, "go")).toBe('(defn go\n  [x]\n  (helper "(" x))');
    expect(locateMember(text, { ns: "demo-app.core", name: "nope" })).toEqual({ found: false });
    expect(locateMember(text, { ns: "demo-app.core" })).toEqual({ found: true });
  });

  it("finds TypeScript, Rust and Python members in their file", () => {
    expect(sourceCandidates({ name: "load", lang: "typescript", file: "web/model.ts" })).toEqual(["web/model.ts"]);
    expect(locateMember("import x from 'y';\n\nexport async function load(): void {}\n", { name: "load", lang: "typescript" }).line).toBe(3);
    const rs = "use tauri;\n\n#[tauri::command]\npub async fn allow_book() {}\n";
    expect(locateMember(rs, { name: "allow_book", lang: "rust" }).line).toBe(3);
    expect(rustExtractMember(rs, "allow_book")).toBe("#[tauri::command]\npub async fn allow_book() {}");
    expect(locateMember("import os\n\nclass Cart:\n    def total(self):\n        return 0\n", { name: "total", lang: "python" }).line).toBe(4);
    expect(sourceCandidates({ name: "x", lang: "typescript" })).toEqual([]);
    expect(sourceCandidates({ name: "x", lang: "cobol", file: "a.cob" })).toEqual([]);
  });

  it("finds Java members by the op name without its signature", () => {
    const java = [
      "package shop.domain;",
      "",
      "import java.util.List;",
      "",
      "public class Order extends Base {",
      "    private final List<Line> lines = List.of();",
      "",
      "    public record Line(Book book, int qty) {",
      "        public long total() { return book.cents() * qty; }",
      "    }",
      "",
      "    class Cursor {",
      "        Cursor(int start) {}",
      "",
      "        boolean hasNext() { return true; }",
      "    }",
      "",
      "    @Override",
      "    public long total() {",
      "        return lines.stream().mapToLong(Line::total).sum();",
      "    }",
      "",
      "    void add(Book book) { lines.add(new Line(book, 1)); }",
      "}",
    ].join("\n");
    const line = (name?: string) => locateMember(java, { ns: "shop.domain.Order", name, lang: "java" }).line;
    expect(line("total()")).toBe(19);
    expect(line("Line.total()")).toBe(9);
    expect(line("Line.Line(Book, int)")).toBe(8);
    expect(line("Cursor.Cursor(int)")).toBe(13);
    expect(line("Cursor.hasNext()")).toBe(15);
    expect(line("add(Book)")).toBe(23);
    expect(line("Line.qty()")).toBe(8); // an implicit record accessor opens at the record
    expect(line("Order()")).toBe(5); // a default constructor opens at the class
    expect(line(undefined)).toBeUndefined();
    expect(javaMemberPath("Line.total(int, Book)")).toEqual({ types: ["Line"], member: "total" });
  });

  it("escapes regex characters in member names", () => {
    expect(locateMember("(defn valid?\n  [x] x)\n(defn valid [x] x)", { name: "valid?" })).toEqual({ found: true, line: 1 });
    expect(locateMember("(defn ->map [x] x)", { name: "->map" }).line).toBe(1);
  });
});
