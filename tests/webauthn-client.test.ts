import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerWebAuthn, registerWebAuthn } from '@/app/lib/webauthn-client';
afterEach(() => vi.unstubAllGlobals());
describe('WebAuthn assertion', () => {
  it('decodes Proxmox challenges and sends the official assertion envelope', async () => {
    vi.stubGlobal('isSecureContext', true);
    const get = vi.fn().mockResolvedValue({ id: 'credential', type: 'public-key', rawId: new Uint8Array([1, 2]).buffer, response: {
      authenticatorData: new Uint8Array([3]).buffer, clientDataJSON: new Uint8Array([4]).buffer, signature: new Uint8Array([5]).buffer,
    } });
    vi.stubGlobal('navigator', { credentials: { get } });
    const result = JSON.parse(await answerWebAuthn({ publicKey: { challenge: 'AQI', rpId: 'ui.example', allowCredentials: [{ type: 'public-key', id: 'Aw' }] } }));
    expect(new Uint8Array(get.mock.calls[0][0].publicKey.challenge)).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(get.mock.calls[0][0].publicKey.allowCredentials[0].id)).toEqual(new Uint8Array([3]));
    expect(result).toEqual({ id: 'credential', type: 'public-key', challenge: 'AQI', rawId: 'AQI', response: { authenticatorData: 'Aw', clientDataJSON: 'BA', signature: 'BQ' } });
  });
  it('fails clearly on insecure origins before requesting a security key', async () => {
    vi.stubGlobal('isSecureContext', false);
    const get = vi.fn();
    vi.stubGlobal('navigator', { credentials: { get } });
    await expect(answerWebAuthn({ publicKey: { challenge: 'AQI' } })).rejects.toThrow('secure HTTPS');
    expect(get).not.toHaveBeenCalled();
  });
});


describe('WebAuthn registration', () => {
  const challenge = JSON.stringify({ publicKey: {
    challenge: 'AQI', user: { id: 'Aw', name: 'user@pve', displayName: 'User' },
    rp: { id: 'ui.example', name: 'Proxmox' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    excludeCredentials: [{ type: 'public-key', id: 'BA' }],
  } });
  it('decodes registration bytes and produces the official second-step parameters', async () => {
    vi.stubGlobal('isSecureContext', true);
    const create = vi.fn().mockResolvedValue({ id: 'credential', type: 'public-key', rawId: new Uint8Array([1]).buffer, response: { attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer } });
    vi.stubGlobal('navigator', { credentials: { create } });
    const result = await registerWebAuthn(challenge);
    expect(result.challenge).toBe('AQI');
    expect(JSON.parse(result.value)).toEqual({ id: 'credential', type: 'public-key', rawId: 'AQ', response: { attestationObject: 'Ag', clientDataJSON: 'Aw' } });
    const parameters = create.mock.calls[0][0].publicKey;
    expect(new Uint8Array(parameters.challenge)).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(parameters.user.id)).toEqual(new Uint8Array([3]));
    expect(new Uint8Array(parameters.excludeCredentials[0].id)).toEqual(new Uint8Array([4]));
    expect(parameters.rp.id).toBe('ui.example');
  });
  it('reports duplicate keys clearly and does not invent a registration result', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { credentials: { create: vi.fn().mockRejectedValue(Object.assign(new Error('existing'), { name: 'InvalidStateError' })) } });
    await expect(registerWebAuthn(challenge)).rejects.toThrow('already registered');
  });
});
