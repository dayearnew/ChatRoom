import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "linux") {
  console.error("The Linux X11 Computer helper must be built on Linux.");
  process.exit(1);
}

const manifest = path.resolve("native/linux/Cargo.toml");
const out = path.resolve("dist/native/linux");
const target = path.join(out, ".cargo-target");
const executable = path.join(out, "chatroom-computer-helper");
mkdirSync(out, { recursive: true });
rmSync(target, { recursive: true, force: true });

const cargo = findCargo();
if (!cargo) {
  console.error(
    "Rust Cargo was not found. Install a Rust toolchain with rustup before building the Linux helper.",
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

const built = path.join(target, "release", "chatroom-computer-helper");
if (!existsSync(built)) {
  rmSync(target, { recursive: true, force: true });
  console.error(`Cargo did not produce ${built}`);
  process.exit(1);
}

copyFileSync(built, executable);
chmodSync(executable, 0o755);
rmSync(target, { recursive: true, force: true });

function findCargo() {
  if (process.env.CARGO && existsSync(process.env.CARGO)) {
    return process.env.CARGO;
  }

  const command = spawnSync("cargo", ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (command.status === 0) return "cargo";

  const rustupCargo = path.join(os.homedir(), ".cargo", "bin", "cargo");
  return existsSync(rustupCargo) ? rustupCargo : null;
}
