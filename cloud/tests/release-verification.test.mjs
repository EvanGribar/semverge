import assert from 'node:assert/strict';
import test from 'node:test';
import { createReleaseTransaction, releaseTransactionMarker } from '../../src/transaction.ts';
import { readReleaseRecord } from '../app/release-verification.ts';

const tag = 'v1.2.0';
const recordedAt = '2023-01-01T00:00:00.000Z';
const now = Date.parse('2026-01-01T00:00:00.000Z');
const transaction = {
  ...createReleaseTransaction({
    version: '1.2.0', sourceCommit: 'a'.repeat(40), packageIds: ['pkg'], tagNames: [tag], npmEnabled: false,
  }),
  published: true,
  phase: 'completed',
};
const event = {
  key: `verification:${tag}`, phase: 'verified', kind: 'post-release-verification',
  target: tag, status: 'completed', attempt: 1, at: recordedAt,
  detail: 'Post-release verification completed with status healthy.',
};
const marker = (...events) => releaseTransactionMarker({ ...transaction, events });
const read = (body) => readReleaseRecord(body, tag, now).verification;

test('reports historical results with their original recording date', () => {
  for (const [reported, status] of [['healthy', 'passed'], ['degraded', 'degraded'], ['disabled', 'disabled']]) {
    const detail = `Post-release verification completed with status ${reported}.`;
    assert.deepEqual(read(marker({ ...event, detail })), { source: 'github-release-body', status, recordedAt });
  }
});

test('uses the latest dated result and rejects ambiguous or unusable evidence', () => {
  const laterFailure = { ...event, status: 'failed', at: '2024-01-01T00:00:00.000Z' };
  assert.equal(read(marker(laterFailure, event)).status, 'failed');
  const conflicting = marker(event, { ...event, status: 'failed' });
  const duplicate = `${marker(event)}\n${marker(laterFailure)}`;
  for (const body of [
    null, marker(), '<!-- semverge-progress malformed -->', conflicting, duplicate,
    marker({ ...event, at: 'invalid' }), marker({ ...event, at: '2027-01-01T00:00:00Z' }),
    marker({ ...event, detail: undefined }), marker({ ...event, target: 'v2.0.0' }),
    releaseTransactionMarker({ ...transaction, failure: { phase: 'verified', message: 'failed', at: recordedAt }, events: [event] }),
  ]) {
    assert.deepEqual(read(body), { source: 'github-release-body', status: 'unavailable' });
  }
});
