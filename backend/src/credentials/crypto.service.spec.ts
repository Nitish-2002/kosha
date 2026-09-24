import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

function buildService(): CryptoService {
  const config = {
    getOrThrow: () => '0'.repeat(64), // 32 zero bytes — fine for a round-trip test
  } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  it('decrypts back to the original plaintext', () => {
    const crypto = buildService();
    const encrypted = crypto.encrypt('super-secret-value');
    expect(crypto.decrypt(encrypted)).toBe('super-secret-value');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const crypto = buildService();
    expect(crypto.encrypt('same-input')).not.toBe(crypto.encrypt('same-input'));
  });

  it('rejects a tampered payload instead of returning garbage', () => {
    const crypto = buildService();
    const encrypted = crypto.encrypt('super-secret-value');
    const tampered = Buffer.from(encrypted, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(tampered.toString('base64'))).toThrow();
  });
});
