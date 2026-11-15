import { parseReleaseTransactionBody, RELEASE_TRANSACTION_MARKER } from '../../src/transaction.ts';

export type RecordedVerification = {
  source: 'github-release-body';
  status: 'passed' | 'degraded' | 'failed' | 'disabled' | 'unavailable';
  recordedAt?: string;
};

export function readReleaseRecord(body: string | null, tag: string, now = Date.now()) {
  let transaction;
  try {
    if (body && body.indexOf(RELEASE_TRANSACTION_MARKER) !== body.lastIndexOf(RELEASE_TRANSACTION_MARKER)) {
      throw new Error('Conflicting release transaction markers');
    }
    transaction = parseReleaseTransactionBody(body);
  } catch {
    transaction = null;
  }
  if (!transaction?.published || !transaction.tagNames.includes(tag)) transaction = null;

  const verification: RecordedVerification = { source: 'github-release-body', status: 'unavailable' };
  if (!transaction) return { transaction, verification };

  const events = transaction.events.filter((event) =>
    event.kind === 'post-release-verification' && event.target === tag);
  const recordedTimes = events.map((event) => Date.parse(event.at));
  if (recordedTimes.some((time) => !Number.isFinite(time) || time > now)) return { transaction, verification };
  const latest = Math.max(...recordedTimes);
  const candidates = events.filter((_, index) => recordedTimes[index] === latest);
  const event = candidates[0];
  if (!event || candidates.some((item) => item.status !== event.status || item.detail !== event.detail)) {
    return { transaction, verification };
  }

  if (event.status === 'failed') verification.status = 'failed';
  if (event.status === 'completed' && !transaction.failure) {
    switch (event.detail) {
      case 'Post-release verification completed with status healthy.':
        verification.status = 'passed';
        break;
      case 'Post-release verification completed with status degraded.':
        verification.status = 'degraded';
        break;
      case 'Post-release verification completed with status disabled.':
        verification.status = 'disabled';
        break;
    }
  }
  if (verification.status !== 'unavailable') verification.recordedAt = new Date(latest).toISOString();
  return { transaction, verification };
}
