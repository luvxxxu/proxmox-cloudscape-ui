'use client';

export interface WebAuthnChallenge {
  publicKey: Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & {
    challenge: string;
    allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
  };
}
function bytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)).buffer;
}
function encoded(value: ArrayBuffer): string {
  return btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function answerWebAuthn(challenge: WebAuthnChallenge): Promise<string> {
  if (!navigator.credentials || !window.isSecureContext) throw new Error('Security keys require a secure HTTPS connection and a compatible browser.');
  const publicKey = challenge.publicKey;
  const credential = await navigator.credentials.get({
    publicKey: { ...publicKey, challenge: bytes(publicKey.challenge), allowCredentials: publicKey.allowCredentials?.map((entry) => ({ ...entry, id: bytes(entry.id) })), timeout: 60000 },
    signal: AbortSignal.timeout(65000),
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Security key authentication was cancelled.');
  const response = credential.response as AuthenticatorAssertionResponse;
  return JSON.stringify({ id: credential.id, type: credential.type, challenge: publicKey.challenge, rawId: encoded(credential.rawId), response: {
    authenticatorData: encoded(response.authenticatorData), clientDataJSON: encoded(response.clientDataJSON), signature: encoded(response.signature),
  } });
}

export interface WebAuthnRegistrationChallenge {
  publicKey: Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
    challenge: string;
    user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
    excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
  };
}

export async function registerWebAuthn(serializedChallenge: string, signal?: AbortSignal): Promise<{ challenge: string; value: string }> {
  if (!navigator.credentials || !window.isSecureContext) throw new Error('Security key registration requires HTTPS and a compatible browser.');
  const challenge = JSON.parse(serializedChallenge) as WebAuthnRegistrationChallenge;
  const publicKey = challenge?.publicKey;
  if (typeof publicKey?.challenge !== 'string' || typeof publicKey.user?.id !== 'string') throw new Error('Proxmox returned an invalid registration challenge.');
  const controller = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  let credential: PublicKeyCredential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: { ...publicKey, challenge: bytes(publicKey.challenge), user: { ...publicKey.user, id: bytes(publicKey.user.id) },
        excludeCredentials: publicKey.excludeCredentials?.map((entry) => ({ ...entry, id: bytes(entry.id) })), timeout: 115000 },
      signal: controller,
    }) as PublicKeyCredential | null;
  } catch (error) {
    if (error instanceof Error && error.name === 'InvalidStateError') throw new Error('This security key is already registered for this account.');
    if (error instanceof Error && error.name === 'SecurityError') throw new Error('The Proxmox WebAuthn RP ID and allowed origin must match this site. Keep existing RP IDs unchanged when preserving enrolled keys.');
    throw error;
  }
  if (signal?.aborted) throw signal.reason;
  if (!credential) throw new Error('Security key registration was cancelled.');
  const response = credential.response as AuthenticatorAttestationResponse;
  return { challenge: publicKey.challenge, value: JSON.stringify({ id: credential.id, type: credential.type, rawId: encoded(credential.rawId), response: {
    attestationObject: encoded(response.attestationObject), clientDataJSON: encoded(response.clientDataJSON),
  } }) };
}
