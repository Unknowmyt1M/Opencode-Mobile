import { describe, it, expect } from 'vitest';
import { evaluateSequenceTransition } from '../packages/protocol/src/sequence.js';

describe('Event Sequence Monotonicity & Gap Detection', () => {
  it('handles normal sequential progression (10 -> 11 -> 12)', () => {
    // 10 initial
    const step1 = evaluateSequenceTransition(undefined, 10);
    expect(step1.action).toBe('ACCEPT');
    expect(step1.nextSequence).toBe(10);

    // 11
    const step2 = evaluateSequenceTransition(step1.nextSequence, 11);
    expect(step2.action).toBe('ACCEPT');
    expect(step2.nextSequence).toBe(11);

    // 12
    const step3 = evaluateSequenceTransition(step2.nextSequence, 12);
    expect(step3.action).toBe('ACCEPT');
    expect(step3.nextSequence).toBe(12);
  });

  it('detects sequence gap (10 -> 12)', () => {
    const step1 = evaluateSequenceTransition(undefined, 10);
    expect(step1.nextSequence).toBe(10);

    const step2 = evaluateSequenceTransition(step1.nextSequence, 12);
    expect(step2.action).toBe('GAP');
    expect(step2.nextSequence).toBe(12);
    expect(step2.gapSize).toBe(1); // missing 11
  });

  it('CRITICAL: never regresses sequence cursor on out-of-order event (10 -> 12 -> 11)', () => {
    // Event 10 arrives
    const step1 = evaluateSequenceTransition(undefined, 10);
    expect(step1.nextSequence).toBe(10);

    // Event 12 arrives (gap detected)
    const step2 = evaluateSequenceTransition(step1.nextSequence, 12);
    expect(step2.action).toBe('GAP');
    expect(step2.nextSequence).toBe(12);

    // Event 11 arrives later (out of order!)
    const step3 = evaluateSequenceTransition(step2.nextSequence, 11);
    expect(step3.action).toBe('STALE');
    // THE CURSOR MUST REMAIN 12, NEVER REGRESSING TO 11!
    expect(step3.nextSequence).toBe(12);
  });

  it('ignores duplicate event without advancing cursor (10 -> 11 -> 11)', () => {
    const step1 = evaluateSequenceTransition(undefined, 10);
    const step2 = evaluateSequenceTransition(step1.nextSequence, 11);
    expect(step2.action).toBe('ACCEPT');
    expect(step2.nextSequence).toBe(11);

    const step3 = evaluateSequenceTransition(step2.nextSequence, 11);
    expect(step3.action).toBe('STALE');
    expect(step3.nextSequence).toBe(11);
  });

  it('resumes normal sequential progression after gap (10 -> 12 -> 13)', () => {
    const step1 = evaluateSequenceTransition(undefined, 10);
    const step2 = evaluateSequenceTransition(step1.nextSequence, 12);
    expect(step2.action).toBe('GAP');
    expect(step2.nextSequence).toBe(12);

    const step3 = evaluateSequenceTransition(step2.nextSequence, 13);
    expect(step3.action).toBe('ACCEPT');
    expect(step3.nextSequence).toBe(13);
  });

  it('preserves independent monotonic cursors across interleaved sessions', () => {
    let cursorA: number | undefined = undefined;
    let cursorB: number | undefined = undefined;

    // Session A receives 1
    cursorA = evaluateSequenceTransition(cursorA, 1).nextSequence;
    expect(cursorA).toBe(1);

    // Session B receives 10
    cursorB = evaluateSequenceTransition(cursorB, 10).nextSequence;
    expect(cursorB).toBe(10);

    // Session A receives 2
    cursorA = evaluateSequenceTransition(cursorA, 2).nextSequence;
    expect(cursorA).toBe(2);

    // Session B receives 12 (gap in B)
    const resB2 = evaluateSequenceTransition(cursorB, 12);
    expect(resB2.action).toBe('GAP');
    cursorB = resB2.nextSequence;
    expect(cursorB).toBe(12);

    // Session B receives 11 (out of order in B) -> cursor stays 12
    const resB3 = evaluateSequenceTransition(cursorB, 11);
    expect(resB3.action).toBe('STALE');
    expect(resB3.nextSequence).toBe(12);

    // Session A is unaffected
    expect(cursorA).toBe(2);
  });
});
