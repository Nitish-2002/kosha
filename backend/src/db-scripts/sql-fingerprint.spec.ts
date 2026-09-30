import { sqlFingerprint } from './sql-fingerprint';

describe('sqlFingerprint', () => {
  it('ignores whitespace, blank lines and trailing semicolons', () => {
    expect(
      sqlFingerprint('CREATE INDEX users_email_idx\n\n    ON users (email);'),
    ).toBe(sqlFingerprint('CREATE INDEX users_email_idx ON users (email)'));
  });

  it('keeps case, so string literals that differ only in case stay distinct', () => {
    expect(sqlFingerprint("INSERT INTO t VALUES ('Demo')")).not.toBe(
      sqlFingerprint("INSERT INTO t VALUES ('demo')"),
    );
  });
});
