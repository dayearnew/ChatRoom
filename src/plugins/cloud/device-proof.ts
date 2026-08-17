import { createHash, createPrivateKey, sign } from "node:crypto";

export function signDeviceProof(input: {
  operation: string;
  installationId: string;
  devicePrivateKey: string;
  payload: unknown;
}): { timestamp: string; signature: string } {
  const timestamp = new Date().toISOString();
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(input.payload))
    .digest("base64url");
  const message = Buffer.from(
    `chatroom-cloud-device-v1\n${input.operation}\n${input.installationId}\n${timestamp}\n${payloadHash}`,
  );
  const key = createPrivateKey({
    key: Buffer.from(input.devicePrivateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return {
    timestamp,
    signature: sign(null, message, key).toString("base64url"),
  };
}
