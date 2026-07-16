import { describe, expect, it } from 'vitest';
import { PHOTO_STATUSES, PHOTO_FAILURE_KINDS, PHOTO_FAILURE_CODES } from '@retaxmaster/my-plants-species-schema/photo-contract-constants';
import type { PhotoStatus, PhotoFailureKind, PhotoFailureCode } from './api';

// Mechanical parity (spec §6.3): the web's TS unions ARE the shared arrays. A type-level assertion catches
// drift at compile time; the runtime asserts the arrays themselves so a future value added on one side fails
// this test until both are updated.
describe('photo-contract parity', () => {
  it('the web unions equal the shared value sets exactly', () => {
    const statuses: PhotoStatus[] = [...PHOTO_STATUSES];
    const kinds: PhotoFailureKind[] = [...PHOTO_FAILURE_KINDS];
    const codes: PhotoFailureCode[] = [...PHOTO_FAILURE_CODES];
    expect(statuses).toEqual(['PENDING', 'PROCESSING', 'RECOVERING', 'READY', 'FAILED']);
    expect(kinds).toEqual(['transient', 'permanent']);
    expect(codes).toEqual(['image_decode_failed', 'image_unsupported_format', 'image_animated', 'image_too_large', 'inbox_lost', 'upload_failed']);
  });
});
