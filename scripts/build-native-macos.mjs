import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const app = path.resolve("dist/native/macos/ChatRoomComputerHelper.app");
const contents = path.join(app, "Contents");
const macos = path.join(contents, "MacOS");
const executable = path.join(macos, "chatroom-computer-helper");
const sources = [
  "native/macos/Models.swift",
  "native/macos/Accessibility.swift",
  "native/macos/Capture.swift",
  "native/macos/Input.swift",
  "native/macos/ComputerSession.swift",
  "native/macos/Protocol.swift",
  "native/macos/main.swift",
];
const deploymentTarget = process.env.CHATROOM_MACOS_DEPLOYMENT_TARGET ?? "15.2";
const architectures = (process.env.CHATROOM_MACOS_ARCHS ?? "arm64,x86_64")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

rmSync(app, { recursive: true, force: true });
mkdirSync(macos, { recursive: true });

const slices = architectures.map((architecture) => {
  const output = path.join(macos, `chatroom-computer-helper.${architecture}`);
  run("xcrun", [
    "--sdk",
    "macosx",
    "swiftc",
    ...sources,
    "-O",
    "-target",
    `${architecture}-apple-macos${deploymentTarget}`,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "ScreenCaptureKit",
    "-framework",
    "ImageIO",
    "-framework",
    "UniformTypeIdentifiers",
    "-o",
    output,
  ]);
  return output;
});

if (slices.length === 1) {
  run("cp", [slices[0], executable]);
} else {
  run("xcrun", ["lipo", "-create", ...slices, "-output", executable]);
}
for (const slice of slices) rmSync(slice, { force: true });
chmodSync(executable, 0o755);

writeFileSync(
  path.join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.chatroomcp.computer</string>
<key>CFBundleName</key><string>ChatRoom Computer Helper</string>
<key>CFBundleDisplayName</key><string>ChatRoom Computer Helper</string>
<key>CFBundleExecutable</key><string>chatroom-computer-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>${deploymentTarget}</string>
<key>LSUIElement</key><true/>
<key>NSHumanReadableCopyright</key><string>ChatRoom</string>
</dict></plist>\n`,
);

const identity = process.env.CHATROOM_MACOS_SIGN_IDENTITY?.trim();
if (!identity) {
  throw new Error("CHATROOM_MACOS_SIGN_IDENTITY is required");
}
run("codesign", [
  "--force",
  "--deep",
  "--sign",
  identity,
  "--options",
  "runtime",
  app,
]);
run("codesign", ["--verify", "--deep", "--strict", app]);

const notaryProfile = process.env.CHATROOM_MACOS_NOTARY_PROFILE;
if (notaryProfile) {
  const archive = path.resolve("dist/native/macos/ChatRoomComputerHelper.zip");
  rmSync(archive, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", app, archive]);
  run("xcrun", [
    "notarytool",
    "submit",
    archive,
    "--keychain-profile",
    notaryProfile,
    "--wait",
  ]);
  run("xcrun", ["stapler", "staple", app]);
  rmSync(archive, { force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
