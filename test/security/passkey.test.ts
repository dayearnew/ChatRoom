import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PasskeyService } from "../../src/auth/passkey-service.js";
import { AppDatabase } from "../../src/infrastructure/database/app-database.js";
import { PasskeyRepository } from "../../src/infrastructure/database/passkey-repository.js";

test("passkey registration options are bound to the supplied WebUI origin", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-passkey-"));
  const db = new AppDatabase(path.join(dir, "auth.sqlite"));
  try {
    const service = new PasskeyService(new PasskeyRepository(db));
    const result = await service.registrationOptions({
      origin: "https://chatroom.example.com",
      rpId: "chatroom.example.com",
    });
    assert.equal(result.options.rp.id, "chatroom.example.com");
    assert.equal(
      result.options.authenticatorSelection?.residentKey,
      "required",
    );
    assert.equal(
      result.options.authenticatorSelection?.userVerification,
      "required",
    );
    assert.match(result.challengeId, /^pkc_/);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
