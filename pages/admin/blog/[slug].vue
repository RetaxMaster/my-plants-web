<script setup lang="ts">
import type { BlogpostAdminDetail, UpdateBlogpost } from '../../../types/api.js';
import { renderMarkdown } from '../../../utils/renderMarkdown.js';
import { needsCoverWarning } from '../../../utils/publishGuard.js';
import { countWords, readingMinutes } from '../../../utils/readingTime.js';

const { t, locales } = useI18n();
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

const api = useApi();
const route = useRoute();
const isDesktop = useIsDesktop();
const slug = route.params.slug as string;

// Language names come from the @nuxtjs/i18n locale config (the source of truth — never a hardcoded
// literal): "English" / "Español" endonyms, exactly as the design bundle shows them.
const localeName = (code: string) =>
  (locales.value as { code: string; name: string }[]).find((l) => l.code === code)?.name ?? code;

const { data: post } = await useAsyncData(`admin-blogpost-${slug}`, () => api.getBlogpostAdmin(slug));

// Local editable form (explicit Save; no autosave). All fields stored as strings; EN/optional fields
// are converted to null on save when blank.
const form = reactive({
  titleEs: '', titleEn: '', excerptEs: '', excerptEn: '', bodyEs: '', bodyEn: '',
  youtubeUrl: '', ctaLink: '', ctaLabelEs: '', ctaLabelEn: '',
  coverImageUrl: null as string | null, coverImageObjectKey: null as string | null,
  coverImagePrompt: null as string | null,
  status: 0 as 0 | 1, slug: '', speciesSlug: null as string | null,
});

// A snapshot of ONLY the fields the Save/Publish action persists (buildBody + status + slug). The
// cover image/prompt are saved via their own endpoints / are read-only, so they never belong to the
// save button's "unsaved changes" state.
function editableSnapshot(): string {
  return JSON.stringify([
    form.titleEs, form.titleEn, form.excerptEs, form.excerptEn,
    form.bodyEs, form.bodyEn, form.youtubeUrl, form.ctaLink,
    form.ctaLabelEs, form.ctaLabelEn, form.status, form.slug,
  ]);
}
// The saved baseline: what the editable fields looked like at the last seed (initial load or after a
// successful save). Dirtiness is a COMPARISON against it — not a latch — so typing a change and then
// reverting it (e.g. type a letter, delete it) returns to "clean".
const baseline = ref<string | null>(null);

function seed(p: BlogpostAdminDetail) {
  form.titleEs = p.titleEs; form.titleEn = p.titleEn ?? '';
  form.excerptEs = p.excerptEs; form.excerptEn = p.excerptEn ?? '';
  form.bodyEs = p.bodyEs; form.bodyEn = p.bodyEn ?? '';
  form.youtubeUrl = p.youtubeUrl ?? ''; form.ctaLink = p.ctaLink ?? '';
  form.ctaLabelEs = p.ctaLabelEs ?? ''; form.ctaLabelEn = p.ctaLabelEn ?? '';
  form.coverImageUrl = p.coverImageUrl; form.coverImageObjectKey = p.coverImageObjectKey;
  form.coverImagePrompt = p.coverImagePrompt;
  form.status = p.status; form.slug = p.slug; form.speciesSlug = p.speciesSlug;
  baseline.value = editableSnapshot(); // capture the saved state as the clean baseline
}
watchEffect(() => { if (post.value) seed(post.value); });

const isFreeForm = computed(() => form.speciesSlug === null);
const isPublished = computed(() => form.status === 1);

const lang = ref<'es' | 'en'>('es');
const langOptions = computed(() => [
  { key: 'es', label: localeName('es') },
  { key: 'en', label: localeName('en') },
]);
const mode = ref<'write' | 'split' | 'read'>('split');
const modeOptions = computed(() => [
  { key: 'write', label: t('blog.editor.modeWrite') },
  { key: 'split', label: t('blog.editor.modeSplit') },
  { key: 'read', label: t('blog.editor.modeRead') },
]);

// Language-aware field bindings.
function langField(esKey: 'titleEs' | 'excerptEs' | 'bodyEs' | 'ctaLabelEs', enKey: 'titleEn' | 'excerptEn' | 'bodyEn' | 'ctaLabelEn') {
  return computed<string>({
    get: () => (lang.value === 'es' ? form[esKey] : form[enKey]),
    set: (v) => { if (lang.value === 'es') form[esKey] = v; else form[enKey] = v; },
  });
}
const title = langField('titleEs', 'titleEn');
const excerpt = langField('excerptEs', 'excerptEn');
const body = langField('bodyEs', 'bodyEn');
const ctaLabel = langField('ctaLabelEs', 'ctaLabelEn');

const words = computed(() => countWords(body.value));
const minutes = computed(() => readingMinutes(body.value));

const previewMd = computed(() =>
  body.value.trim() ? body.value : `*${lang.value === 'es' ? t('blog.editor.previewEmptyEs') : t('blog.editor.previewEmptyEn')}*`,
);
const previewHtml = computed(() => renderMarkdown(previewMd.value));

const ctaHint = computed(() => {
  const hasLink = form.ctaLink.trim();
  const hasCopy = ctaLabel.value.trim();
  if (hasLink && !hasCopy) return t('blog.editor.ctaHintLinkNoCopy');
  if (hasLink && hasCopy) return t('blog.editor.ctaHintBoth');
  return t('blog.editor.ctaHintNone');
});

// Dirty = the editable fields differ from the saved baseline (a comparison, not a latch — reverting a
// change clears it). Recomputes whenever any compared field changes.
const savedFlash = ref(false);
const dirty = computed(() => baseline.value !== null && editableSnapshot() !== baseline.value);
// Clear the transient "saved" flash the instant a real change reappears.
watch(dirty, (d) => { if (d) savedFlash.value = false; });

const saveState = computed(() => (savedFlash.value ? 'saved' : dirty.value ? 'dirty' : 'clean'));

// Cover upload adapter (this page owns the endpoint glue; ImageUploadField owns the UX).
const coverUpload = (file: File) => {
  const f = new FormData();
  f.append('cover', file);
  return api.uploadBlogpostCover(slug, f).then((updated) => {
    form.coverImageUrl = updated.coverImageUrl;
    form.coverImageObjectKey = updated.coverImageObjectKey;
    return { url: updated.coverImageUrl! };
  });
};

// Publish guard modal.
const guardOpen = ref(false);
const pendingPublish = ref<boolean | undefined>(undefined);
const saveError = ref(false);
const saving = ref(false);

function buildBody(publish?: boolean): UpdateBlogpost {
  const body: UpdateBlogpost = {
    titleEs: form.titleEs,
    titleEn: form.titleEn.trim() || null,
    excerptEs: form.excerptEs,
    excerptEn: form.excerptEn.trim() || null,
    bodyEs: form.bodyEs,
    bodyEn: form.bodyEn.trim() || null,
    youtubeUrl: form.youtubeUrl.trim() || null,
    ctaLink: form.ctaLink.trim() || null,
    ctaLabelEs: form.ctaLabelEs.trim() || null,
    ctaLabelEn: form.ctaLabelEn.trim() || null,
  };
  if (isFreeForm.value && form.slug !== slug) body.slug = form.slug.trim();
  if (publish !== undefined) body.status = publish ? 1 : 0;
  return body;
}

async function persist(publish?: boolean) {
  saving.value = true;
  saveError.value = false;
  try {
    const updated = await api.updateBlogpost(slug, buildBody(publish));
    if (updated.slug !== slug) {
      // A free-form slug rename changes the @id -> navigate to the new editor URL.
      await navigateTo(`/admin/blog/${updated.slug}`);
      return;
    }
    seed(updated); // re-baselines the form → dirty (computed) becomes false
    savedFlash.value = true;
    setTimeout(() => (savedFlash.value = false), 2500);
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

// Save (keeps current status) or the explicit publish toggle. The publish guard fires whenever the
// action results in a PUBLISHED post AND the post has no cover image (which is also its Meta/OG card).
async function save(publish?: boolean) {
  const willBePublished = publish === true || (publish === undefined && isPublished.value);
  if (willBePublished && needsCoverWarning(form.coverImageUrl)) {
    pendingPublish.value = publish;
    guardOpen.value = true;
    return;
  }
  await persist(publish);
}

async function confirmGuardPublish() {
  guardOpen.value = false;
  await persist(pendingPublish.value);
}
</script>

<template>
  <div v-if="post" class="mp-editor">
    <!-- head -->
    <div class="mp-editor__head">
      <button type="button" class="mp-backlink mp-editor__back" @click="navigateTo('/admin/blog')">
        <UiAppIcon name="chevron-left" :size="16" color="currentColor" /> {{ $t('blog.editor.back') }}
      </button>
      <div class="mp-editor__lang">
        <UiSegmentedControl v-model="lang" :options="langOptions" :aria-label="$t('nav.language')" />
        <span class="mp-editor__langhint">{{ $t('blog.editor.langHint') }}</span>
      </div>
    </div>

    <div class="mp-editor__title-block">
      <UiAutosizeTextarea v-model="title" :placeholder="$t('blog.editor.titlePlaceholder')" class="mp-editor__title" />
      <div class="mp-editor__slug">
        <template v-if="isFreeForm">
          <span class="mp-editor__slugprefix">{{ $t('blog.editor.slugPrefix') }}</span>
          <input v-model="form.slug" class="mp-editor__sluginput" spellcheck="false" />
        </template>
        <template v-else>
          <span class="mp-editor__slugprefix">{{ $t('blog.editor.slugPrefix') }}</span>{{ form.slug }}
          <span class="mp-editor__sluglock">· {{ $t('blog.editor.slugLocked') }}</span>
        </template>
      </div>
      <UiAutosizeTextarea v-model="excerpt" :placeholder="$t('blog.editor.excerptPlaceholder')" class="mp-editor__excerpt" />

      <div class="mp-editor__statusbar">
        <UiBadge :color="isPublished ? 'green' : 'neutral'" size="xs" :dot="isPublished">{{ $t(`blog.status.${form.status}`) }}</UiBadge>
        <span class="mp-editor__vis">{{ isPublished ? $t('blog.editor.publicVisible') : $t('blog.editor.draftVisible') }}</span>
        <UiButton
          size="sm" variant="solid"
          :color="isPublished ? 'neutral' : 'primary'"
          :icon="isPublished ? 'arrow-down-circle' : 'arrow-up-circle'"
          :loading="saving" @click="save(!isPublished)"
        >{{ isPublished ? $t('blog.editor.moveToDraft') : $t('blog.editor.publish') }}</UiButton>
        <span class="mp-editor__wordcount">{{ $t('blog.editor.wordsMin', { words, min: minutes }) }}</span>
      </div>
    </div>

    <!-- details -->
    <UiCard class="mp-editor__details" padded>
      <div class="mp-editor__detailstitle">{{ $t('blog.editor.postDetails') }}</div>
      <div class="mp-editor__detailsgrid">
        <UiImageUploadField
          :upload="coverUpload"
          :label="$t('blog.editor.coverImage')"
          :hint="$t('blog.editor.coverHint')"
          :current-url="form.coverImageUrl"
        />
        <div v-if="form.coverImagePrompt" class="mp-editor__coverprompt">
          <UiCopyableField
            :model-value="form.coverImagePrompt"
            :label="$t('blog.editor.coverPromptLabel')"
            :rows="6"
          />
          <p class="mp-editor__coverprompthint">{{ $t('blog.editor.coverPromptHint') }}</p>
        </div>
        <UiFormGroup :label="$t('blog.editor.youtube')" :hint="$t('blog.editor.youtubeHint')">
          <UiInput v-model="form.youtubeUrl" icon="play-circle" placeholder="https://www.youtube.com/watch?v=…" />
        </UiFormGroup>
        <div class="mp-editor__ctagrid">
          <UiFormGroup :label="$t('blog.editor.ctaLink')">
            <UiInput v-model="form.ctaLink" icon="link" placeholder="https://myplants.app/premium" />
          </UiFormGroup>
          <UiFormGroup :label="lang === 'es' ? $t('blog.editor.ctaLabelEs') : $t('blog.editor.ctaLabelEn')" :hint="ctaHint">
            <UiInput v-model="ctaLabel" />
          </UiFormGroup>
        </div>
      </div>
    </UiCard>

    <!-- body -->
    <div class="mp-editor__bodyhead">
      <UiSectionTitle class="mp-editor__bodytitle">{{ $t('blog.editor.bodyTitle') }}</UiSectionTitle>
      <UiSegmentedControl v-model="mode" :options="modeOptions" :aria-label="$t('blog.editor.bodyTitle')" />
    </div>

    <div class="mp-editor__bodygrid" :class="{ 'mp-editor__bodygrid--split': isDesktop && mode === 'split' }">
      <div v-if="mode !== 'read'">
        <textarea v-model="body" class="mp-md-input" spellcheck="false" :placeholder="$t('blog.editor.bodyPlaceholder')" />
        <div class="mp-editor__bodyhint">{{ $t('blog.editor.bodyHint') }}</div>
      </div>
      <article v-if="mode !== 'write'" class="mp-editor__preview" :class="{ 'mp-editor__preview--read': mode === 'read' }">
        <div class="mp-editor__previewbar">
          <UiBadge color="cafe" size="xs">{{ $t('blog.editor.preview') }}</UiBadge>
          <span class="mp-editor__previewhint">{{ $t('blog.editor.previewHint') }}</span>
        </div>
        <UiProse :html="previewHtml" />
        <div v-if="form.ctaLink.trim() && ctaLabel.trim()" class="mp-editor__previewcta">
          <UiButton trailing-icon="arrow-right">{{ ctaLabel }}</UiButton>
        </div>
      </article>
    </div>

    <!-- floating save bar -->
    <div class="mp-savebar" :style="{ bottom: isDesktop ? '22px' : '84px' }">
      <span class="mp-savebar__state" :class="`mp-savebar__state--${saveState}`">
        <span class="mp-savebar__dot" />
        {{ saveError ? $t('blog.editor.saveError') : saveState === 'saved' ? $t('blog.editor.saved') : saveState === 'dirty' ? $t('blog.editor.dirty') : $t('blog.editor.clean') }}
      </span>
      <span class="mp-savebar__meta">{{ localeName(lang) }} · {{ $t('blog.editor.wordsMin', { words, min: minutes }) }}</span>
      <UiButton
        size="sm"
        :loading="saving"
        :disabled="saveState !== 'dirty'"
        @click="save()"
      >{{ saveState === 'dirty' ? (isPublished ? $t('blog.editor.save') : $t('blog.editor.saveDraft')) : $t('blog.editor.allSaved') }}</UiButton>
    </div>

    <!-- publish guard -->
    <UiModal v-model="guardOpen" :title="$t('blog.editor.guardNoCoverTitle')">
      <p class="mp-editor__guardbody">{{ $t('blog.editor.guardNoCoverBody') }}</p>
      <div class="mp-editor__guardactions">
        <UiButton variant="ghost" color="neutral" @click="guardOpen = false">{{ $t('blog.editor.guardKeep') }}</UiButton>
        <UiButton :loading="saving" @click="confirmGuardPublish">{{ $t('blog.editor.guardPublish') }}</UiButton>
      </div>
    </UiModal>
  </div>

  <UiEmptyState v-else>{{ $t('blog.editor.gone') }}</UiEmptyState>
</template>

<style scoped>
.mp-editor { padding-bottom: 84px; }
.mp-editor__head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.mp-editor__back { margin-bottom: 0; }
.mp-editor__lang { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.mp-editor__langhint { font: 11px var(--font-sans); color: var(--text-faint); }

.mp-editor__title-block { max-width: 760px; }
.mp-editor__title :deep(textarea) { font: 800 clamp(26px, 4vw, 36px)/1.15 var(--font-sans); letter-spacing: -0.02em; caret-color: var(--green-600); }
.mp-editor__excerpt :deep(textarea) { font: 15px/1.6 var(--font-sans); color: var(--text-muted); caret-color: var(--green-600); }
.mp-editor__slug { font: 11px var(--font-mono); color: var(--text-faint); margin: 6px 0 10px; word-break: break-all; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mp-editor__slugprefix { color: var(--accent-green-ink, var(--green-600)); }
.mp-editor__sluginput { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 2px 6px; font: 11px var(--font-mono); color: var(--text-body); background: var(--surface-card); }
.mp-editor__sluglock { color: var(--text-faint); }
.mp-editor__statusbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); padding: 12px 2px; margin-top: 14px; }
.mp-editor__vis { font: 13px var(--font-sans); color: var(--text-muted); }
.mp-editor__wordcount { margin-left: auto; font: 12px var(--font-sans); color: var(--text-faint); }

.mp-editor__details { margin-top: 22px; max-width: 760px; }
.mp-editor__detailstitle { font: 700 15px var(--font-sans); color: var(--text-strong); margin-bottom: 16px; }
.mp-editor__detailsgrid { display: grid; gap: 18px; }
.mp-editor__ctagrid { display: grid; gap: 18px; grid-template-columns: 1fr; }
@media (min-width: 880px) { .mp-editor__ctagrid { grid-template-columns: 1fr 1fr; } }
.mp-editor__coverprompt { display: grid; gap: var(--space-2); }
.mp-editor__coverprompthint { margin: 0; font: 11px var(--font-sans); color: var(--text-faint); }

.mp-editor__bodyhead { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 30px 0 16px; }
.mp-editor__bodytitle { margin: 0; }
.mp-editor__bodyhead > :last-child { margin-left: auto; }
.mp-editor__bodygrid { display: grid; gap: 24px; grid-template-columns: 1fr; align-items: start; }
.mp-editor__bodygrid--split { grid-template-columns: 1fr 1fr; }
.mp-md-input { height: 56vh; min-height: 320px; }
.mp-editor__bodygrid--split .mp-md-input { height: calc(100vh - 190px); }
.mp-editor__bodyhint { font: 11px var(--font-mono); color: var(--text-faint); margin-top: 6px; padding: 0 4px; }
.mp-editor__preview { max-width: 680px; width: 100%; min-width: 0; }
.mp-editor__preview--read { justify-self: center; }
.mp-editor__previewbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.mp-editor__previewhint { font: 12px var(--font-sans); color: var(--text-faint); }
.mp-editor__previewcta { margin-top: 24px; }

.mp-savebar__state { display: inline-flex; align-items: center; gap: 7px; font: 600 12px var(--font-sans); white-space: nowrap; }
.mp-savebar__state--clean { color: var(--text-faint); }
.mp-savebar__state--dirty { color: var(--care-caution-text, var(--text-muted)); }
.mp-savebar__state--saved { color: var(--accent-green-ink, var(--green-600)); }
.mp-savebar__dot { width: 6px; height: 6px; border-radius: 99px; background: currentColor; }
.mp-savebar__meta { font: 12px var(--font-sans); color: var(--text-faint); white-space: nowrap; }

.mp-editor__guardbody { margin: 0 0 16px; font: 14px/1.6 var(--font-sans); color: var(--text-body); }
.mp-editor__guardactions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
