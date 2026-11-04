import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A scratch copy of examples/ served by the built umlify CLI and web app,
 * with files rewritten the way producers write them: temp file, then rename.
 */

// The compiled bin, as `npm link` installs it (npm run e2e builds it first).
const cli = new URL("../../packages/server/dist/cli.js", import.meta.url).pathname;
const examples = new URL("../../examples/", import.meta.url).pathname;

export class ScratchProject {
  readonly dir = mkdtempSync(join(tmpdir(), "umlify-e2e-"));
  private server?: ChildProcess;
  url = "";

  constructor() {
    cpSync(examples, this.dir, { recursive: true });
  }

  get ir(): string {
    return join(this.dir, "uml-viewer.edn");
  }

  start(port = 0): Promise<string> {
    return new Promise((done, fail) => {
      const server = spawn(process.execPath, [cli, "--no-open", "--port", String(port), this.ir]);
      this.server = server;
      let out = "";
      server.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0];
        if (url) done((this.url = url));
      });
      server.stderr.on("data", (chunk: Buffer) => fail(new Error(chunk.toString())));
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server || server.exitCode !== null) return;
    const exited = new Promise((done) => server.once("exit", done));
    server.kill("SIGTERM");
    await exited;
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }

  read(path = this.ir): string {
    return readFileSync(path, "utf8");
  }

  writeAtomically(path: string, text: string): void {
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  }

  /** Add a file to the project, `rel` relative to its root. */
  write(rel: string, text: string): void {
    mkdirSync(dirname(join(this.dir, rel)), { recursive: true });
    writeFileSync(join(this.dir, rel), text);
  }

  /** Rewrite the IR through `edit`. */
  editIR(edit: (text: string) => string): void {
    this.writeAtomically(this.ir, edit(this.read()));
  }
}
