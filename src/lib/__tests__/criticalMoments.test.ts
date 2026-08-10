import { describe, it, expect } from 'vitest';
import { tierFor, labelsFor } from '../criticalMoments';
import { seqHistory, rep } from './helpers';

describe('tierFor', () => {
  it('градація за рівнем перед спробою', () => {
    expect(tierFor(0)).toBe('normal');
    expect(tierFor(7)).toBe('normal');
    expect(tierFor(8)).toBe('significant');
    expect(tierFor(9)).toBe('rare');
    expect(tierFor(10)).toBe('exceptional');
    expect(tierFor(11)).toBe('major');
  });
});

describe('labelsFor', () => {
  it('CLUTCH: успіх після 4+ провалів', () => {
    const prior = seqHistory([['mirage', true], ...rep('world', false, 4)]);
    const labels = labelsFor({ method: 'mirage', success: true, before: 1, after: 2, p: 0.3 }, prior);
    expect(labels).toContain('CLUTCH');
  });

  it('MIRACLE: успіх із p <= 5%', () => {
    const labels = labelsFor({ method: 'world', success: true, before: 4, after: 5, p: 0.0167 }, []);
    expect(labels).toContain('MIRACLE');
  });

  it('DISASTER: падіння на 5+ рівнів', () => {
    const labels = labelsFor({ method: 'mirage', success: false, before: 5, after: 0, p: 0.3 }, []);
    expect(labels).toContain('DISASTER');
  });

  it('BACK_TO_BACK: другий успіх поспіль', () => {
    const prior = seqHistory([['mirage', true]]);
    const labels = labelsFor({ method: 'mirage', success: true, before: 1, after: 2, p: 0.3 }, prior);
    expect(labels).toContain('BACK_TO_BACK');
  });

  it('ONE_TAP: успіх з першої спроби на 8+', () => {
    const labels = labelsFor({ method: 'sky', success: true, before: 8, after: 9, p: 0.4 }, []);
    expect(labels).toContain('ONE_TAP');
  });
});
