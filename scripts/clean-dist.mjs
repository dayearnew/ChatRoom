import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const native = path.join(dist, "native");
const savedNative = path.resolve(`.chatroom-native-${process.pid}`);

rmSync(savedNative, { recursive: true, force: true });
if (existsSync(native)) renameSync(native, savedNative);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
if (existsSync(savedNative)) renameSync(savedNative, native);
