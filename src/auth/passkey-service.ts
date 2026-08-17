import { randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import type { PasskeyRepository } from "../core/auth/passkey-repository.js";
import { ChatRoomError } from "../core/errors/chatroom-error.js";
import type { WebAuthnOrigin } from "./ingress-policy.js";

type ChallengeKind = "registration" | "authentication";
interface ChallengeRecord extends WebAuthnOrigin {
  kind: ChallengeKind;
  challenge: string;
  expiresAt: number;
}

export class PasskeyService {
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(private readonly repository: PasskeyRepository) {}

  list() {
    return this.repository.list().map((item) => ({
      id: item.credentialId,
      name: item.name,
      lastUsedAt: item.lastUsedAt,
    }));
  }

  remove(credentialId: string): void {
    this.repository.remove(credentialId);
  }

  async registrationOptions(origin: WebAuthnOrigin | null) {
    const expected = requireOrigin(origin);
    const passkeys = this.repository.list();
    const options = await generateRegistrationOptions({
      rpName: "ChatRoom",
      rpID: expected.rpId,
      userName: "chatroom-owner",
      userDisplayName: "ChatRoom Owner",
      userID: Buffer.from("chatroom-owner"),
      attestationType: "none",
      excludeCredentials: passkeys.map((item) => ({
        id: item.credentialId,
        transports: item.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const challengeId = this.storeChallenge(
      "registration",
      options.challenge,
      expected,
    );
    return { challengeId, options };
  }

  async verifyRegistration(input: {
    challengeId: string;
    response: RegistrationResponseJSON;
    name?: string;
  }) {
    const record = this.consumeChallenge(input.challengeId, "registration");
    if (!record)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Passkey challenge is invalid or expired",
      );
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: record.challenge,
      expectedOrigin: record.origin,
      expectedRPID: record.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Passkey registration could not be verified",
      );
    const now = new Date().toISOString();
    const credential = verification.registrationInfo.credential;
    this.repository.upsert({
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports:
        credential.transports ?? input.response.response.transports ?? [],
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      name: input.name?.trim().slice(0, 80) || "Passkey",
      createdAt: now,
      lastUsedAt: now,
    });
    return { registered: true, credentialId: credential.id };
  }

  async authenticationOptions(origin: WebAuthnOrigin | null) {
    const expected = requireOrigin(origin);
    const passkeys = this.repository.list();
    if (!passkeys.length)
      throw new ChatRoomError("NOT_FOUND", "No passkeys are registered");
    const options = await generateAuthenticationOptions({
      rpID: expected.rpId,
      userVerification: "required",
    });
    const challengeId = this.storeChallenge(
      "authentication",
      options.challenge,
      expected,
    );
    return { challengeId, options };
  }

  async verifyAuthentication(input: {
    challengeId: string;
    response: AuthenticationResponseJSON;
  }): Promise<{ credentialId: string }> {
    const record = this.consumeChallenge(input.challengeId, "authentication");
    if (!record)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Passkey challenge is invalid or expired",
      );
    const passkey = this.repository.get(input.response.id);
    if (!passkey)
      throw new ChatRoomError("FORBIDDEN", "Unknown passkey credential");
    const publicKey = new Uint8Array(passkey.publicKey.byteLength);
    publicKey.set(passkey.publicKey);
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: record.challenge,
      expectedOrigin: record.origin,
      expectedRPID: record.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey,
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
    if (!verification.verified)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Passkey authentication could not be verified",
      );
    this.repository.updateCounter(
      passkey.credentialId,
      verification.authenticationInfo.newCounter,
    );
    return { credentialId: passkey.credentialId };
  }

  private storeChallenge(
    kind: ChallengeKind,
    challenge: string,
    origin: WebAuthnOrigin,
  ): string {
    this.pruneChallenges();
    while (this.challenges.size >= 64) {
      const oldest = this.challenges.keys().next().value as string | undefined;
      if (!oldest) break;
      this.challenges.delete(oldest);
    }
    const id = `pkc_${randomUUID()}`;
    this.challenges.set(id, {
      kind,
      challenge,
      origin: origin.origin,
      rpId: origin.rpId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return id;
  }

  private consumeChallenge(
    id: string,
    kind: ChallengeKind,
  ): ChallengeRecord | null {
    const record = this.challenges.get(id);
    this.challenges.delete(id);
    if (!record || record.kind !== kind || record.expiresAt <= Date.now())
      return null;
    return record;
  }

  private pruneChallenges(): void {
    const now = Date.now();
    for (const [id, record] of this.challenges)
      if (record.expiresAt <= now) this.challenges.delete(id);
  }
}

function requireOrigin(origin: WebAuthnOrigin | null): WebAuthnOrigin {
  if (!origin)
    throw new ChatRoomError(
      "UNSUPPORTED",
      "Passkeys require a secure public WebUI origin",
    );
  return origin;
}
