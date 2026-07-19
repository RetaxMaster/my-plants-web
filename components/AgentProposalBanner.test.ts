// @vitest-environment happy-dom
//
// The banner is the platform's consent surface. What it must guarantee: the OWNER sees the server's
// structured operation list, not the agent's prose. If consent were based on `summary`, an agent could
// describe a harmless edit over a destructive operation set and the platform gate would be a prompt gate.
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import AgentProposalBanner from './AgentProposalBanner.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

const PROPOSAL = {
  id: 'prop-1',
  status: 'PENDING' as const,
  summary: 'Just a tiny nickname tweak, nothing else.',
  autoApproved: false,
  failureCode: null,
  failureReason: null,
  createdAt: '2026-07-18T10:00:00.000Z',
  operations: [
    {
      type: 'profile.update' as const,
      targetLabel: 'profile',
      destructive: false,
      changes: [{ field: 'Pot type', before: 'Plastic', after: 'Terracotta' }],
    },
    {
      type: 'progress.delete' as const,
      targetLabel: '2026-07-12',
      destructive: true,
      changes: [{ field: 'Observations', before: 'leaf spots', after: null }],
    },
  ],
};

function mountBanner(props: Record<string, unknown> = {}) {
  return mount(AgentProposalBanner, {
    props: { proposal: PROPOSAL, i18nNamespace: 'diagnose', ...props },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiAlert: { props: ['color', 'title', 'description'], template: '<div class="alert" :data-color="color"><span class="alert-title">{{ title }}</span><slot /></div>' },
        UiChangeList: { props: ['changes', 'emptyValue', 'staleLabel'], template: '<ul class="changes"><li v-for="c in changes" :key="c.field">{{ c.field }}:{{ c.before }}>{{ c.after }}</li></ul>' },
        // `emits: ['click']` is not decoration. The real UiButton declares its click event, so Vue does
        // NOT also apply the parent's handler as a native listener. A stub that omits the declaration
        // gets the handler twice — once via $emit, once via attribute fallthrough — and reports a
        // double-resolve the real component cannot produce. A double must be faithful in BOTH directions:
        // able to fail the property it proves, and unable to invent a failure.
        UiButton: {
          props: ['disabled', 'loading'],
          emits: ['click'],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

describe('AgentProposalBanner', () => {
  it('renders every server operation with its resolved target label', () => {
    const w = mountBanner();
    expect(w.text()).toContain('profile');
    expect(w.text()).toContain('2026-07-12');
    expect(w.text()).toContain('diagnose.proposal.opType.profileUpdate');
    expect(w.text()).toContain('diagnose.proposal.opType.progressDelete');
  });

  it('renders the change list from server data (before → after)', () => {
    const w = mountBanner();
    expect(w.find('.changes').text()).toContain('Pot type:Plastic>Terracotta');
  });

  // The point of §5.4: prose is a caption, attributed to the agent, and NEVER the thing being approved.
  it('renders the summary as an attributed caption, not as the operation list', () => {
    const w = mountBanner();
    expect(w.text()).toContain('diagnose.proposal.agentSays');
    expect(w.text()).toContain('Just a tiny nickname tweak');
    // …and the destructive operation is still shown despite the summary claiming otherwise.
    expect(w.text()).toContain('diagnose.proposal.opType.progressDelete');
  });

  // The strongest form of the same rule: a LYING summary changes nothing about what is displayed. If this
  // ever fails, the consent surface has started taking the agent's word for something.
  it('renders the identical operation list no matter what the summary claims', () => {
    const honest = mountBanner({ proposal: { ...PROPOSAL, summary: 'I will delete an entry.' } });
    const lying = mountBanner({ proposal: { ...PROPOSAL, summary: 'Nothing destructive here at all.' } });
    expect(lying.find('.mp-proposal__ops').html()).toBe(honest.find('.mp-proposal__ops').html());
    expect(lying.text()).toContain('diagnose.proposal.destructive');
  });

  it('omits the caption entirely when the agent wrote no summary', () => {
    const w = mountBanner({ proposal: { ...PROPOSAL, summary: '' } });
    expect(w.text()).not.toContain('diagnose.proposal.agentSays');
  });

  it('discloses that a destructive operation cannot be undone', () => {
    const w = mountBanner();
    expect(w.text()).toContain('diagnose.proposal.destructive');
  });

  // The warning belongs to the operation that destroys, not to the whole banner: attaching it to a
  // proposal that only edits fields would train the owner to ignore it.
  it('attaches the destructive warning only to the destructive operation', () => {
    const w = mountBanner();
    const ops = w.findAll('.mp-proposal__op');
    expect(ops[0].text()).not.toContain('diagnose.proposal.destructive');
    expect(ops[1].text()).toContain('diagnose.proposal.destructive');

    const safeOnly = mountBanner({ proposal: { ...PROPOSAL, operations: [PROPOSAL.operations[0]] } });
    expect(safeOnly.text()).not.toContain('diagnose.proposal.destructive');
  });

  // Colour is a real signal here, not decoration: a proposal that destroys something must not look like
  // one that edits a field.
  it('escalates the alert colour when any operation is destructive', () => {
    expect(mountBanner().find('.alert').attributes('data-color')).toBe('red');
    const safeOnly = mountBanner({ proposal: { ...PROPOSAL, operations: [PROPOSAL.operations[0]] } });
    expect(safeOnly.find('.alert').attributes('data-color')).toBe('amber');
  });

  it('emits approve, decline and dismiss — and performs no I/O itself', async () => {
    const w = mountBanner();
    const buttons = w.findAll('button');
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    await buttons[2].trigger('click');
    expect(w.emitted('approve')).toHaveLength(1);
    expect(w.emitted('decline')).toHaveLength(1);
    expect(w.emitted('dismiss')).toHaveLength(1);
  });

  it('disables the actions and shows the applying label while busy', () => {
    const w = mountBanner({ busy: true });
    expect(w.text()).toContain('diagnose.proposal.applying');
    expect(w.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  // A double-click on Approve must not file two approvals. The parent sets `busy`, and the guard is that
  // the disabled button stops emitting at all.
  it('emits nothing while busy, so a double click cannot resolve twice', async () => {
    const w = mountBanner({ busy: true });
    for (const b of w.findAll('button')) await b.trigger('click');
    expect(w.emitted('approve')).toBeUndefined();
    expect(w.emitted('decline')).toBeUndefined();
    expect(w.emitted('dismiss')).toBeUndefined();
  });

  it('renders an error message when the resolution failed', () => {
    const w = mountBanner({ errorMessage: 'diagnose.proposal.conflict.expired' });
    expect(w.text()).toContain('diagnose.proposal.conflict.expired');
  });

  // A failure the owner cannot see is the silent no-op §5.3.1 forbids, so it is announced.
  it('announces the failure to assistive technology', () => {
    const w = mountBanner({ errorMessage: 'diagnose.proposal.applyError' });
    expect(w.find('[role="alert"]').exists()).toBe(true);
  });

  it('renders no error region when nothing failed', () => {
    expect(mountBanner().find('[role="alert"]').exists()).toBe(false);
  });

  // An operation carrying no field-level changes must still render its own heading. Falling through to
  // nothing would show the owner a proposal with an invisible operation inside it.
  it('still names an operation that carries no field changes', () => {
    const w = mountBanner({
      proposal: {
        ...PROPOSAL,
        operations: [{ type: 'care.done' as const, targetLabel: 'WATER', destructive: false, changes: [] }],
      },
    });
    expect(w.text()).toContain('diagnose.proposal.opType.careDone');
    expect(w.text()).toContain('WATER');
    expect(w.find('.changes').exists()).toBe(false);
  });
});
