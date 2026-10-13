import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject, type OnChanges, type OnDestroy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { ReferenceComponent } from './reference';
import { OperationFeedbackComponent } from './feedback';
import type { ReferencePort } from './reference-client';
import { INPUT_LIMITS, codePointLength } from '@klaro/contracts';
import { UK_UI, type Language } from '@klaro/language-profiles';
import { EditorSession } from './session';
import { LanguageSelectorComponent } from './language-selector';
import { EditorScheduler, type RunPort } from './scheduler';

export { ApiReferenceClient } from './reference-client';
export { EditorSession } from './session';
export { LanguageSelectorComponent } from './language-selector';
export { ApiOperationClient } from './api-client';
export { EditorScheduler, type RunPort } from './scheduler';

@Component({
  selector: 'klaro-workspace-shell',
  imports: [MatCardModule, MatInputModule, MatButtonModule, MatSelectModule, LanguageSelectorComponent, ReferenceComponent, OperationFeedbackComponent],
  template: `
    <main [class.panel]="surface === 'panel'">
      <mat-card><mat-card-header><mat-card-title><h1>{{ labels.welcome }}</h1></mat-card-title></mat-card-header>
        <mat-card-content>
          <div class="modes" role="group" [attr.aria-label]="labels.mode"><button matButton [attr.aria-pressed]="mode === 'correction'" (click)="changeMode('correction')">{{ labels.correction }}</button><button matButton [attr.aria-pressed]="mode === 'translation'" (click)="changeMode('translation')">{{ labels.translator }}</button></div>
          <klaro-language-selector [preferences]="session.preferences" [disabled]="disabled" (languageChange)="languageChange.emit($event)" />
          @if (mode === 'translation') { <div role="group" [attr.aria-label]="labels.translationDirection"><p>{{ languageName(session.translationLanguages().sourceLanguage) }} → {{ languageName(session.translationLanguages().targetLanguage) }}</p><button matButton (click)="swapTranslation()" [disabled]="disabled">{{ labels.swapTranslation }}</button></div> }
          <div class="actions"><button matButton (click)="scheduler?.run()" [attr.aria-disabled]="scheduler?.busy ? 'true' : null" [disabled]="disabled || !scheduler || !withinLimit() || session.selectionInvalid || !session.input.trim()">{{ labels.run }}</button><button matButton (click)="scheduler?.setLive(!(scheduler?.live ?? false))" [disabled]="disabled || !scheduler" [attr.aria-pressed]="scheduler?.live ?? false">{{ labels.live }}</button><button matButton (click)="scheduler?.pause()" [disabled]="!scheduler || (!scheduler.live && !scheduler.busy)">{{ labels.pause }}</button></div>
          <p role="status" aria-live="polite" aria-atomic="true">{{ scheduler?.busy ? labels.processing : scheduler?.error ? failureText(scheduler?.error) : session.result && !session.resultStale ? labels.resultReady : '' }}</p>
          @if (session.originals.length) { <mat-form-field><mat-label>{{ labels.originals }}</mat-label><mat-select (selectionChange)="restore($event.value)">@for (original of session.originals; track original.id) { <mat-option [value]="original.id">{{ original.text.slice(0, 60) }}</mat-option> }</mat-select></mat-form-field> }
          <button matButton (click)="clear()">{{ labels.clear }}</button>
          @if (mode === 'correction') { <div role="group" [attr.aria-label]="labels.recommendationActions"><button matButton (click)="scheduler?.run(true, 'paraphrase')" [attr.aria-disabled]="scheduler?.busy ? 'true' : null" [disabled]="disabled || !scheduler || !withinLimit() || !session.input.trim()">{{ labels.paraphrase }}</button><button matButton (click)="scheduler?.run(true, 'alternatives')" [attr.aria-disabled]="scheduler?.busy ? 'true' : null" [disabled]="disabled || !scheduler || !withinLimit() || !session.input.trim() || (session.alternatives && !session.hasNextAlternative())">{{ labels.moreVariants }}</button></div> }
          @if (session.alternatives) { <p role="status">{{ labels.variant }} {{ session.alternativeNumber() }} / {{ session.alternatives.alternatives.length }}</p> }
          @if (mode === 'correction') { <button matButton (click)="scheduler?.explain()" [attr.aria-disabled]="scheduler?.busy ? 'true' : null" [disabled]="disabled || !scheduler || session.resultStale || session.result?.kind !== 'correction' || !session.recommendationOperationId">{{ labels.explain }}</button> }
          <button matButton (click)="session.protectSelection()" [disabled]="session.selection.scope !== 'selection' || session.selectionInvalid || session.protectedSpans.length >= 100">{{ labels.protectSelection }}</button>
          @if (session.protectedSpans.length) { <p>{{ labels.protectedText }}:</p><ul>@for (span of session.protectedSpans; track $index) { <li>{{ session.input.slice(span.start, span.end) }}</li> }</ul><button matButton (click)="session.clearProtection()">{{ labels.clearProtection }}</button> }
          <div class="areas" [class.two-areas]="mode === 'translation'">
            <section><mat-form-field><mat-label>{{ labels.inputText }}</mat-label>
              <textarea matInput rows="8" [value]="session.input" (input)="inputChanged($event)" (select)="selectionChanged($event)" (keyup)="selectionChanged($event)" (mouseup)="selectionChanged($event)" [attr.aria-describedby]="counterId" [attr.aria-invalid]="!withinLimit() || session.selectionInvalid"></textarea>
            </mat-form-field><p [id]="counterId">{{ labels.characters }}: {{ session.count() }} / {{ maximum() }}</p>
              @if (!withinLimit()) { <p role="status">{{ labels.inputOverLimit }}</p> }
              @if (session.selection.scope === 'selection') { <p role="status">{{ labels.selectedCharacters }}: {{ count(session.selectedInput()) }}. {{ labels.contextCharacters }}: {{ count(session.context() ?? '') }} / 4000. {{ labels.selectionResultOnly }}</p> }
              @if (session.selectionInvalid) { <p role="status">{{ labels.selectionInvalid }}</p> }
            </section>
            <section><mat-form-field><mat-label>{{ mode === 'correction' ? labels.recommendation : labels.translationResult }}</mat-label>
              <textarea #mainResult matInput rows="8" readonly [value]="session.mainText()" [placeholder]="labels.noResult"></textarea>
            </mat-form-field><button matButton (click)="copyPrimary()" [disabled]="session.resultStale || !session.mainText()">{{ labels.copy }}</button><p role="status">{{ copyStatus }}</p></section>
            @if (mode === 'correction') {
              <section><mat-form-field><mat-label>{{ labels.nativeRendering }}</mat-label>
                <textarea matInput rows="8" readonly [value]="session.nativeResult?.text ?? ''" [placeholder]="labels.noResult"></textarea>
              </mat-form-field><p>{{ labels.nativeCaution }}</p>@if (scheduler?.nativeError) { <p role="status">{{ labels.nativeFailed }}</p><button matButton (click)="scheduler?.runNative()" [disabled]="disabled || scheduler?.busy || session.resultStale">{{ labels.retryNative }}</button> }</section>
            }
          </div>
          @if (mode === 'correction' && editGroups().length) {
            <section [attr.aria-labelledby]="editsId"><h2 [id]="editsId">{{ labels.edits }}</h2><ol>
              @for (group of editGroups(); track group.groupId; let number = $index) {
                <li><strong>{{ labels.edit }} {{ number + 1 }}</strong>
                  @for (edit of group.edits; track $index) { <p><strong>{{ labels.beforeEdit }}:</strong>{{ ' ' }}<del>{{ edit.original || labels.emptyFragment }}</del> → <strong>{{ labels.afterEdit }}:</strong>{{ ' ' }}<ins>{{ edit.replacement || labels.emptyFragment }}</ins></p> }
                  <p>{{ session.editAccepted(group.groupId) ? labels.editAccepted : labels.editRejected }}</p>
                  <div role="group" [attr.aria-label]="labels.edit + ' ' + (number + 1)"><button matButton (click)="session.reviewEdit(group.groupId, true)" [disabled]="disabled || session.resultStale" [attr.aria-pressed]="session.editAccepted(group.groupId)">{{ labels.acceptEdit }}</button><button matButton (click)="session.reviewEdit(group.groupId, false)" [disabled]="disabled || session.resultStale" [attr.aria-pressed]="!session.editAccepted(group.groupId)">{{ labels.rejectEdit }}</button></div>
                </li>
              }
            </ol></section>
          }
          @if (session.result?.warnings?.includes('no-changes')) { <p>{{ labels.noChanges }}</p> }
          @if (session.result?.warnings?.includes('protected-term-conflict')) { <p role="status">{{ labels.protectionConflict }}</p> }
          @if (session.result?.warnings?.includes('ambiguous-input')) { <p role="status">{{ labels.ambiguousInput }}</p> }
          @if (session.result?.warnings?.includes('language-mismatch')) { <p role="status">{{ labels.languageMismatch }}</p> }
          @if (session.resultStale) { <p role="status">{{ labels.resultStale }}</p> }
          @defer (when session.primaryOperationId && !session.resultStale) { <klaro-operation-feedback [operationId]="session.primaryOperationId" [port]="port" [disabled]="disabled || session.resultStale || scheduler?.busy === true" /> }
          @if (mode === 'correction' && session.nativeStale) { <p role="status">{{ labels.nativeStale }}</p> }
          @if (mode === 'correction' && session.explanation) { <section [attr.aria-labelledby]="explanationId"><h2 [id]="explanationId">{{ labels.explanation }}</h2><p>{{ session.explanation.text }}</p>@if (session.explanationStale) { <p role="status">{{ labels.explanationStale }}</p> }</section> }
          @if (scheduler?.explanationError) { <p role="status">{{ labels.explanationFailed }}</p> }
          @if (referencePort) { <button matButton (click)="lookupSelection()" [disabled]="disabled || !selectedWord()">Довідка про виділене слово</button><button matButton (click)="referenceOpen = !referenceOpen" [disabled]="disabled">Довідник слова</button>@defer (when referenceOpen) { @if (referenceOpen) { <klaro-reference #referenceCard [port]="referencePort" [operations]="port" [surface]="surface" [preferences]="session.preferences" [disabled]="disabled" [lookupWord]="referenceWord" [lookupLanguage]="referenceLanguage" /> } } }
        </mat-card-content>
      </mat-card>
    </main>`,
  styles: ['main { padding: 16px; max-width: 1400px; margin: auto; } h1 { font-size: 1.5rem; line-height: 1.4; margin: 0 0 16px; } mat-form-field { display: block; width: 100%; } textarea { resize: vertical; } :focus-visible { outline: 3px solid #005cbb; outline-offset: 3px; } del, ins { color: inherit; } .areas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } .two-areas { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panel .areas { grid-template-columns: 1fr; } @media (max-width: 900px) { .areas { grid-template-columns: 1fr; } }'],
})
export class WorkspaceShellComponent implements OnChanges, OnDestroy {
  @Input() session = new EditorSession();
  @Input() disabled = false;
  @Input() surface: 'panel' | 'web' = 'web';
  @Input() mode: 'correction' | 'translation' = 'correction';
  @Input() limit: number | undefined;
  @Input() port: RunPort | undefined;
  @Input() referencePort: ReferencePort | undefined;
  @ViewChild('referenceCard') private reference: { openWord(word: string, language: Language): void; reset(): void } | undefined;
  selectedWord(): string { const selection = this.session.selection; if (this.session.selectionInvalid || selection.scope !== 'selection') return ''; const word = this.session.input.slice(selection.start, selection.end).trim(); return word.length <= 200 ? word : ''; }
  referenceOpen = false; referenceWord = ''; referenceLanguage: Language = 'de';
  lookupSelection(): void { const word = this.selectedWord(); if (word) { const language = this.mode === 'translation' ? this.session.translationLanguages().sourceLanguage : this.session.preferences.activeWritingLanguage; if (this.reference && this.referenceWord === word && this.referenceLanguage === language) this.reference.openWord(word, language); else { this.referenceWord = word; this.referenceLanguage = language; } this.referenceOpen = true; } }
  scheduler: EditorScheduler | undefined;
  private schedulerSession: EditorSession | undefined;
  private schedulerPort: RunPort | undefined;
  private readonly changes = inject(ChangeDetectorRef);
  ngOnChanges(): void {
    if (this.schedulerSession !== this.session || this.schedulerPort !== this.port) {
      this.scheduler?.dispose(); this.schedulerSession = this.session; this.schedulerPort = this.port;
      this.scheduler = this.port ? new EditorScheduler(this.session, this.port, this.surface, undefined, () => this.changes.markForCheck()) : undefined;
    }
    this.scheduler?.setEnabled(!this.disabled);
  }
  ngOnDestroy(): void { this.scheduler?.dispose(); this.session.clear(); }
  @ViewChild('mainResult') private mainResult: ElementRef<HTMLTextAreaElement> | undefined;
  copyStatus = '';
  restore(id: string): void { this.scheduler?.pause(); this.copyStatus = ''; this.session.restoreOriginal(id); }
  clear(): void { this.scheduler?.pause(); this.copyStatus = ''; this.session.clear(); this.reference?.reset(); }
  async copyPrimary(): Promise<void> {
    if (this.session.resultStale || !this.session.mainText()) return;
    try { await navigator.clipboard.writeText(this.session.mainText()); this.copyStatus = this.labels.copied; }
    catch { this.mainResult?.nativeElement.focus(); this.mainResult?.nativeElement.select(); this.copyStatus = this.labels.manualCopy; }
    this.changes.markForCheck();
  }
  readonly counterId = `input-counter-${crypto.randomUUID()}`;
  readonly editsId = `edits-${crypto.randomUUID()}`;
  readonly explanationId = `explanation-${crypto.randomUUID()}`;
  editGroups() { return this.session.result?.kind === 'correction' ? this.session.result.editGroups : []; }
  changeMode(mode: 'correction' | 'translation'): void { this.mode = mode; this.session.setMode(mode); }
  swapTranslation(): void { this.copyStatus = ''; this.session.swapTranslation(); }
  languageName(language: Language): string { return this.labels.languages[language]; }
  maximum(): number { return this.limit && Number.isSafeInteger(this.limit) && this.limit > 0 ? Math.min(this.limit, INPUT_LIMITS[this.surface]) : INPUT_LIMITS[this.surface]; }
  withinLimit(): boolean { return this.session.withinLimit(this.surface, this.maximum()); }
  @Output() readonly languageChange = new EventEmitter<Language>();
  readonly labels = UK_UI;
  readonly count = codePointLength;
  failureText(code: string | undefined): string { return code === 'quota-exceeded' ? this.labels.quotaExceeded : code === 'unauthenticated' ? this.labels.sessionExpired : code === 'indeterminate' ? this.labels.indeterminate : code === 'input-too-large' ? this.labels.tokenLimit : this.labels.processingFailed; }
  selectionChanged(event: Event): void { const textarea = event.target as HTMLTextAreaElement; this.session.setSelection(textarea.selectionStart, textarea.selectionEnd); }

  inputChanged(event: Event): void {
    this.session.setInput((event.target as HTMLTextAreaElement).value);
  }
}

export { ProcessingConsent } from './processing-consent';
export { ProcessingConsentComponent, ProcessingDetailsComponent } from './privacy';
