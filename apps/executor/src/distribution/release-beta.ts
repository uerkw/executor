import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readDistributionPackageMetadata, repoRoot } from "./metadata";
import { resolveNextBetaVersion } from "./release-beta-version";

const packageJsonPath = resolve(repoRoot, "apps/executor/package.json");

type ReleaseBetaCliOptions = {
  dryRun: boolean;
};

type CommandInput = {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  captureOutput?: boolean;
};

type CommandOutput = {
  stdout: string;
  stderr: string;
};

const parseArgs = (argv: ReadonlyArray<string>): ReleaseBetaCliOptions => {
  const options: ReleaseBetaCliOptions = {
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const runCommand = async (input: CommandInput): Promise<CommandOutput> => {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: process.env,
    stdio: input.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  let stdout = "";
  let stderr = "";

  if (input.captureOutput) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
  }

  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolveExitCode(code ?? -1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(
      [
        `${input.command} ${input.args.join(" ")} exited with code ${exitCode}`,
        stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : null,
        stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : null,
      ]
        .filter((part) => part !== null)
        .join("\n\n"),
    );
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
};

const assertVersionFileIsUnchanged = async (): Promise<void> => {
  const output = await runCommand({
    command: "git",
    args: ["status", "--short", "--", "apps/executor/package.json"],
    cwd: repoRoot,
    captureOutput: true,
  });

  if (output.stdout.length > 0) {
    throw new Error(
      [
        "Refusing to publish a beta with existing changes to apps/executor/package.json.",
        "Commit, stash, or discard that file first.",
        output.stdout,
      ].join("\n"),
    );
  }
};

const getCurrentBranch = async (): Promise<string> => {
  const output = await runCommand({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: repoRoot,
    captureOutput: true,
  });

  const branch = output.stdout.trim();
  if (!branch) {
    throw new Error("Unable to determine the current git branch.");
  }

  return branch;
};

const updatePackageVersion = async (nextVersion: string): Promise<void> => {
  const contents = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(contents) as { version?: string };
  packageJson.version = nextVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
};

const assertTagDoesNotExist = async (tag: string): Promise<void> => {
  const output = await runCommand({
    command: "git",
    args: ["tag", "--list", tag],
    cwd: repoRoot,
    captureOutput: true,
  });

  if (output.stdout.trim() === tag) {
    throw new Error(`Refusing to publish beta because git tag ${tag} already exists.`);
  }
};

const printPlan = (input: {
  currentVersion: string;
  nextVersion: string;
  branch: string;
}): void => {
  const tag = `v${input.nextVersion}`;

  process.stdout.write(`Current version: ${input.currentVersion}\n`);
  process.stdout.write(`Next beta: ${input.nextVersion}\n`);
  process.stdout.write(`Branch: ${input.branch}\n`);
  process.stdout.write("Planned actions:\n");
  process.stdout.write("- Update apps/executor/package.json\n");
  process.stdout.write("- Build publish artifact with release:publish:dry-run\n");
  process.stdout.write(`- Commit with message: release: ${input.nextVersion}\n`);
  process.stdout.write(`- Push branch: ${input.branch}\n`);
  process.stdout.write(`- Create tag: ${tag}\n`);
  process.stdout.write(`- Push tag: ${tag}\n`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const branch = await getCurrentBranch();
  const currentVersion = (await readDistributionPackageMetadata()).version;
  const nextVersion = resolveNextBetaVersion(currentVersion);
  const tag = `v${nextVersion}`;

  if (options.dryRun) {
    printPlan({
      currentVersion,
      nextVersion,
      branch,
    });
    return;
  }

  await assertVersionFileIsUnchanged();
  await assertTagDoesNotExist(tag);

  await updatePackageVersion(nextVersion);
  process.stdout.write(`Updated apps/executor/package.json to ${nextVersion}\n`);

  await runCommand({
    command: "bun",
    args: ["run", "--cwd", "apps/executor", "release:publish:dry-run"],
    cwd: repoRoot,
  });

  await runCommand({
    command: "git",
    args: ["add", "apps/executor/package.json"],
    cwd: repoRoot,
  });

  await runCommand({
    command: "git",
    args: ["commit", "-m", `release: ${nextVersion}`],
    cwd: repoRoot,
  });

  await runCommand({
    command: "git",
    args: ["push", "origin", branch],
    cwd: repoRoot,
  });

  await runCommand({
    command: "git",
    args: ["tag", tag],
    cwd: repoRoot,
  });

  await runCommand({
    command: "git",
    args: ["push", "origin", tag],
    cwd: repoRoot,
  });

  process.stdout.write(`Published beta release trigger for ${nextVersion}\n`);
};

await main();
