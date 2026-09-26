/**
 * Monotonic sequence evaluation and gap detection utilities.
 * Ensures stream and event cursors never regress backwards.
 */

export type SequenceAction = 'ACCEPT' | 'STALE' | 'GAP';

export interface SequenceEvaluation {
  action: SequenceAction;
  nextSequence: number;
  gapSize?: number;
}

/**
 * Evaluates an incoming sequence number against the last recorded sequence cursor.
 * Guarantees that the sequence cursor is strictly monotonic (never regresses backwards).
 *
 * @param lastSequence The current last-seen sequence number (or undefined if no prior sequence)
 * @param incomingSequence The new incoming sequence number from the event/message
 */
export function evaluateSequenceTransition(
  lastSequence: number | undefined,
  incomingSequence: number
): SequenceEvaluation {
  if (typeof incomingSequence !== 'number' || isNaN(incomingSequence)) {
    return { action: 'STALE', nextSequence: typeof lastSequence === 'number' ? lastSequence : 0 };
  }

  // Initial event for this session
  if (lastSequence === undefined) {
    return { action: 'ACCEPT', nextSequence: incomingSequence };
  }

  // Stale, duplicate, or out-of-order event: cursor MUST NOT regress!
  if (incomingSequence <= lastSequence) {
    return { action: 'STALE', nextSequence: lastSequence };
  }

  // Sequential monotonic progression: last + 1
  if (incomingSequence === lastSequence + 1) {
    return { action: 'ACCEPT', nextSequence: incomingSequence };
  }

  // Sequence gap detected: incoming > last + 1
  return {
    action: 'GAP',
    nextSequence: incomingSequence,
    gapSize: incomingSequence - (lastSequence + 1),
  };
}
