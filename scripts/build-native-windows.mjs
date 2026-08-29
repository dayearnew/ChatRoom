import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.error("The Windows Computer helper must be built on Windows.");
  process.exit(1);
}

const manifest = path.resolve("native/windows/Cargo.toml");
const out = path.resolve("dist/native/windows");
const target = path.join(out, ".cargo-target");
const executable = path.join(out, "chatroom-computer-helper.exe");
mkdirSync(out, { recursive: true });
rmSync(target, { recursive: true, force: true });

const cargo = findCargo();
if (!cargo) {
  console.error(
    "Rust Cargo was not found. Install the Rust MSVC toolchain with rustup before building the Windows helper.",
  );
  process.exit(1);
}

const result = spawnSync(
  cargo,
  ["build", "--release", "--manifest-path", manifest],
  {
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: target },
  },
);
if (result.status !== 0) {
  rmSync(target, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

const built = path.join(target, "release", "chatroom-computer-helper.exe");
if (!existsSync(built)) {
  rmSync(target, { recursive: true, force: true });
  console.error(`Cargo did not produce ${built}`);
  process.exit(1);
}
try {
  copyFileSync(built, executable);
} catch (error) {
  rmSync(target, { recursive: true, force: true });
  if (error?.code === "EBUSY" || error?.code === "EPERM") {
    console.error(
      "Windows Computer helper is currently running. Stop ChatRoom or the helper before rebuilding it.",
    );
    process.exit(1);
  }
  throw error;
}
rmSync(target, { recursive: true, force: true });

function findCargo() {
  if (process.env.CARGO && existsSync(process.env.CARGO))
    return process.env.CARGO;

  const command = spawnSync("cargo", ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (command.status === 0) return "cargo";

  const home = process.env.USERPROFILE ?? os.homedir();
  const rustupCargo = path.join(home, ".cargo", "bin", "cargo.exe");
  return existsSync(rustupCargo) ? rustupCargo : null;
}
