// ONE definition of "what a chat-attachment path looks like", consumed by BOTH the BFF (which must
// recognize it to take the binary branch) and useApi (which must build it). Two spellings would be two
// chances to disagree — and the failure mode of disagreement is silent: the BFF falls through to the
// JSON passthrough and the browser gets an index-keyed object instead of an image.
import { describe, it, expect } from 'vitest';
import {
  isChatAttachmentPath, knowledgeChatAttachmentPath, doctorChatAttachmentPath, gardenerChatAttachmentPath,
} from './chatAttachmentPath.js';

describe('chat attachment paths', () => {
  it('builds the knowledge-chat path', () => {
    expect(knowledgeChatAttachmentPath('s1', 'r1', 'a1'))
      .toBe('/knowledge-chat/sessions/s1/runs/r1/attachments/a1');
  });

  it('builds the doctor path under its plant', () => {
    expect(doctorChatAttachmentPath('p1', 's1', 'r1', 'a1'))
      .toBe('/plants/p1/diagnose/sessions/s1/runs/r1/attachments/a1');
  });

  it('builds the gardener path', () => {
    expect(gardenerChatAttachmentPath('s1', 'r1', 'a1'))
      .toBe('/gardener/sessions/s1/runs/r1/attachments/a1');
  });

  // attachmentId is BROWSER-generated and runId is the API's own string; either can carry a character
  // that changes what url is being requested if interpolated raw.
  it('percent-encodes every segment', () => {
    expect(gardenerChatAttachmentPath('a/b', 'c d', '../e'))
      .toBe('/gardener/sessions/a%2Fb/runs/c%20d/attachments/..%2Fe');
  });

  it('recognizes all three surfaces, with or without a query string', () => {
    expect(isChatAttachmentPath('/knowledge-chat/sessions/s/runs/r/attachments/a')).toBe(true);
    expect(isChatAttachmentPath('/plants/p/diagnose/sessions/s/runs/r/attachments/a')).toBe(true);
    expect(isChatAttachmentPath('/gardener/sessions/s/runs/r/attachments/a')).toBe(true);
    expect(isChatAttachmentPath('/gardener/sessions/s/runs/r/attachments/a?x=1')).toBe(true);
  });

  // The binary branch must be NARROW. Every other route in this app returns JSON, and widening this
  // matcher by accident would route a JSON response through a raw-bytes path.
  it('does not match anything else', () => {
    for (const p of [
      '/plants',
      '/gardener/sessions/s/runs/r/log',
      '/gardener/sessions/s/runs/r/socket-ticket',
      '/knowledge-chat/sessions/s/history',
      '/gardener/sessions/s/runs/r/attachments',
      '/gardener/sessions/s/runs/r/attachments/a/extra',
    ]) {
      expect(isChatAttachmentPath(p)).toBe(false);
    }
  });
});
