import { refreshOutcome } from './refresh-plan';

const applied = {
  status: 'applied' as const,
  appliedBy: 'user-1',
  appliedAt: new Date('2026-09-20T10:00:00Z'),
};
const pending = {
  status: 'pending' as const,
  appliedBy: null,
  appliedAt: null,
};
const notApplicable = {
  status: 'not_applicable' as const,
  appliedBy: null,
  appliedAt: null,
};

describe('refreshOutcome', () => {
  it('carries over what the source had applied, with who/when', () => {
    expect(refreshOutcome(false, pending, applied)).toEqual({
      ...applied,
      rule: 'in_source',
    });
  });

  it('sends back to pending what the source never ran, even if the target had', () => {
    expect(refreshOutcome(false, applied, pending).status).toBe('pending');
    expect(refreshOutcome(false, applied, undefined).rule).toBe(
      'not_in_source',
    );
  });

  it('treats N/A in the source as not in the dump', () => {
    expect(refreshOutcome(false, applied, notApplicable).status).toBe(
      'pending',
    );
  });

  it('always re-runs re-run-after-restore scripts, whatever the source', () => {
    expect(refreshOutcome(true, applied, applied)).toMatchObject({
      status: 'pending',
      rule: 'rerun_after_restore',
    });
  });

  it('keeps N/A for the restored environment, ahead of every other rule', () => {
    expect(refreshOutcome(true, notApplicable, applied).status).toBe(
      'not_applicable',
    );
  });
});
