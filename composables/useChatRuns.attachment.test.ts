// The three runs adapters are the per-surface seam AgentChat is handed. Each must reach ITS OWN route —
// a doctor chat that fetched through the gardener path would 404 every thumbnail, silently, and the
// screen would look exactly like an expired conversation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKnowledgeChatRuns } from './useKnowledgeChatRuns.js';
import { useDoctorChatRuns } from './useDoctorChatRuns.js';
import { useGardenerChatRuns } from './useGardenerChatRuns.js';

const fetchChatAttachment = vi.fn(async () => new Blob(['x'], { type: 'image/png' }));
beforeEach(() => {
  fetchChatAttachment.mockClear();
  vi.stubGlobal('useApi', () => ({
    fetchChatAttachment,
    mintKnowledgeSocketTicket: vi.fn(),
    mintDoctorSocketTicket: vi.fn(),
    mintGardenerSocketTicket: vi.fn(),
  }));
});

describe('fetchAttachment on each runs adapter', () => {
  it('knowledge chat reaches the admin KE path', async () => {
    await useKnowledgeChatRuns().fetchAttachment('s1', 'r1', 'a1');
    expect(fetchChatAttachment).toHaveBeenCalledWith('/knowledge-chat/sessions/s1/runs/r1/attachments/a1');
  });

  it('the doctor reaches ITS PLANT\'s diagnose path', async () => {
    await useDoctorChatRuns('p1').fetchAttachment('s1', 'r1', 'a1');
    expect(fetchChatAttachment).toHaveBeenCalledWith('/plants/p1/diagnose/sessions/s1/runs/r1/attachments/a1');
  });

  it('the gardener reaches the owner-anchored path, with no plant in it', async () => {
    await useGardenerChatRuns().fetchAttachment('s1', 'r1', 'a1');
    expect(fetchChatAttachment).toHaveBeenCalledWith('/gardener/sessions/s1/runs/r1/attachments/a1');
  });

  it('returns the Blob through unchanged — the package mints the object url, never us', async () => {
    const blob = await useGardenerChatRuns().fetchAttachment('s1', 'r1', 'a1');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
