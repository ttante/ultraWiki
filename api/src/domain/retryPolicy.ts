export type FailureType = 'transient' | 'permanent';

export const classifyError = (message: string): FailureType => {
  const transientPatterns = [/timeout/i, /5\d\d/, /ECONNRESET/i, /temporar/i];
  return transientPatterns.some((p) => p.test(message)) ? 'transient' : 'permanent';
};

export const nextRetryState = (
  currentAttempt: number,
  maxAttempts: number,
  failureType: FailureType
): 'retrying' | 'dead_letter' => {
  if (failureType === 'permanent') {
    return 'dead_letter';
  }
  return currentAttempt < maxAttempts ? 'retrying' : 'dead_letter';
};
