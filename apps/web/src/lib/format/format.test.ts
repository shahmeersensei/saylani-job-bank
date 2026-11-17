import { describe, expect, it } from 'vitest';
import { PAKISTAN_MOBILE_PREFIXES as SHARED_MOBILE_PREFIXES } from '@jobbank/shared';
import { formatCnic, isValidCnic, maskCnic } from './cnic';
import {
  PAKISTAN_MOBILE_PREFIXES,
  formatPkMobileDisplay,
  formatPkMobileNational,
  isSupportedPkMobile,
  maskPkMobile,
  normalizePkMobile,
} from './phone';

describe('normalizePkMobile', () => {
  it.each(['03001234567', '+923001234567', '923001234567', '0092 300 1234567', '300-1234567'])(
    'normalizes %s to E.164',
    (input) => expect(normalizePkMobile(input)).toBe('+923001234567'),
  );

  it.each(['', '0211234567', '+92212345678', '30012345', '4001234567'])('rejects %j', (input) => {
    expect(normalizePkMobile(input)).toBeNull();
  });

  it('formats national and display forms', () => {
    expect(formatPkMobileNational('300')).toBe('300');
    expect(formatPkMobileNational('3001234')).toBe('300 1234');
    expect(formatPkMobileDisplay('+923001234567')).toBe('+92 300 1234567');
  });

  // M11: employers see a masked phone — recognisable, not callable.
  it('masks the middle digits for employer display', () => {
    expect(maskPkMobile('+923001234567')).toBe('+92300***4567');
    expect(maskPkMobile('03001234567')).toBe('030012***4567');
    expect(maskPkMobile('short')).toBe('***');
  });

  it('recognizes only listed original allocation prefixes', () => {
    expect(isSupportedPkMobile('+923441234567')).toBe(true);
    expect(isSupportedPkMobile('+923991234567')).toBe(false);
  });

  // Audit 2026-11-11 (L-03): the dropdown table and the shared schema
  // list must hold the same prefixes, or the input and the schema
  // disagree again.
  it('dropdown prefix table matches the shared allowlist', () => {
    expect([...PAKISTAN_MOBILE_PREFIXES.map(({ prefix }) => prefix)].sort()).toEqual(
      [...SHARED_MOBILE_PREFIXES].sort(),
    );
  });
});

describe('CNIC helpers', () => {
  it('formats progressively', () => {
    expect(formatCnic('42101')).toBe('42101');
    expect(formatCnic('421011234')).toBe('42101-1234');
    expect(formatCnic('4210112345671')).toBe('42101-1234567-1');
    expect(formatCnic('42101-1234567-19999')).toBe('42101-1234567-1');
  });

  it('validates complete numbers only', () => {
    expect(isValidCnic('42101-1234567-1')).toBe(true);
    expect(isValidCnic('4210112345671')).toBe(true);
    expect(isValidCnic('42101-1234567')).toBe(false);
    expect(isValidCnic('42101-12345a7-1')).toBe(false);
  });

  it('masks the middle block', () => {
    expect(maskCnic('4210112345671')).toBe('42101-•••••••-1');
  });
});
