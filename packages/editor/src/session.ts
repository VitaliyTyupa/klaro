import { DEFAULT_PREFERENCES, INPUT_LIMITS, PreferencesSchema, codePointLength, isUtf16Boundary, type OperationCommand, type OperationResult, type Preferences } from '@klaro/contracts';

export function codePointOffsetToUtf16(text: string, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > codePointLength(text)) throw new Error('Invalid code point offset');
  return Array.from(text).slice(0, offset).join('').length;
}
export function utf16OffsetToCodePoint(text: string, offset: number): number {
  if (!Number.isSafeInteger(offset) || !isUtf16Boundary(text, offset)) throw new Error('Invalid UTF-16 offset');
  return codePointLength(text.slice(0, offset));
}

export class EditorSession {
  input = '';
  mode: 'correction' | 'translation' = 'correction';
  translationReversed = false;
  translationLanguages(): { sourceLanguage: Preferences['nativeLanguage']; targetLanguage: Preferences['nativeLanguage'] } {
    const { nativeLanguage, activeWritingLanguage } = this.preferences;
    return this.translationReversed ? { sourceLanguage: activeWritingLanguage, targetLanguage: nativeLanguage } : { sourceLanguage: nativeLanguage, targetLanguage: activeWritingLanguage };
  }
  swapTranslation(): void { this.translationReversed = !this.translationReversed; this.invalidate(); }
  revisionId = crypto.randomUUID();
  preferences: Preferences = structuredClone(DEFAULT_PREFERENCES);
  result: OperationResult | undefined;
  resultStale = false;
  primaryOperationId: string | undefined;
  nativeResult: Extract<OperationResult, { kind: 'translation' }> | undefined;
  nativeStale = false;
  explanation: Extract<OperationResult, { kind: 'explanation' }> | undefined;
  explanationStale = false;
  alternatives: Extract<OperationResult, { kind: 'alternatives' }> | undefined;
  selectedAlternativeId: string | undefined;
  private alternativesOperationId: string | undefined;
  alternativeNumber(): number { return (this.alternatives?.alternatives.findIndex(value => value.recommendationId === this.selectedAlternativeId) ?? -1) + 1; }
  hasNextAlternative(): boolean { return !!this.alternatives && this.alternatives.revisionId === this.revisionId && this.alternativeNumber() < this.alternatives.alternatives.length; }
  selectNextAlternative(): boolean {
    const next = this.hasNextAlternative() ? this.alternatives?.alternatives[this.alternativeNumber()] : undefined;
    return next ? this.selectAlternative(next.recommendationId) : false;
  }
  selectAlternative(recommendationId: string): boolean {
    const alternative = this.alternatives?.alternatives.find(value => value.recommendationId === recommendationId);
    if (!alternative || this.alternatives?.revisionId !== this.revisionId || this.selectedAlternativeId === recommendationId) return false;
    this.selectedAlternativeId = recommendationId;
    this.result = { kind: 'correction', language: this.preferences.activeWritingLanguage, revisionId: this.revisionId, ...alternative, editGroups: [], warnings: this.alternatives?.warnings ?? [] };
    this.correctionBase = undefined; this.rejectedGroups.clear(); this.recommendationOperationId = this.alternativesOperationId;
    this.primaryOperationId = this.alternativesOperationId;
    this.resultStale = false; this.nativeResult = undefined; this.nativeStale = true;
    this.explanationStale = this.explanation !== undefined;
    for (const listener of this.recommendationListeners) listener();
    return true;
  }
  recommendationOperationId: string | undefined;
  private correctionBase: Extract<OperationResult, { kind: 'correction' }> | undefined;
  private correctionOriginal = '';
  private readonly rejectedGroups = new Set<string>();
  private readonly recommendationListeners = new Set<() => void>();
  subscribeRecommendation(listener: () => void): () => void { this.recommendationListeners.add(listener); return () => this.recommendationListeners.delete(listener); }
  editAccepted(groupId: string): boolean { return !this.rejectedGroups.has(groupId); }
  reviewEdit(groupId: string, accepted: boolean): boolean {
    const base = this.correctionBase;
    if (this.resultStale || this.result?.kind !== 'correction' || !base || !base.editGroups.some(group => group.groupId === groupId) || this.editAccepted(groupId) === accepted) return false;
    if (accepted) this.rejectedGroups.delete(groupId); else this.rejectedGroups.add(groupId);
    const edits = base.editGroups.filter(group => !this.rejectedGroups.has(group.groupId)).flatMap(group => group.edits).sort((a, b) => b.span.start - a.span.start);
    let text = this.correctionOriginal;
    for (const edit of edits) text = text.slice(0, edit.span.start) + edit.replacement + text.slice(edit.span.end);
    this.result = { ...this.result, recommendationId: crypto.randomUUID(), text };
    this.alternatives = undefined; this.alternativesOperationId = undefined; this.selectedAlternativeId = undefined;
    this.nativeResult = undefined; this.nativeStale = true;
    this.explanationStale = this.explanation !== undefined;
    for (const listener of this.recommendationListeners) listener();
    return true;
  }
  readonly originals: { id: string; text: string }[] = [];
  rememberOriginal(): void {
    if (!this.input.trim() || this.originals.at(-1)?.text === this.input) return;
    this.originals.push({ id: crypto.randomUUID(), text: this.input });
    if (this.originals.length > 10) this.originals.shift();
  }
  restoreOriginal(id: string): boolean {
    const original = this.originals.find(value => value.id === id);
    if (!original) return false;
    this.input = original.text; this.protectedSpans.length = 0; this.selection = { scope: 'document' }; this.selectionInvalid = false; this.invalidate(); return true;
  }
  selection: OperationCommand['selection'] = { scope: 'document' };
  selectionInvalid = false;
  readonly protectedSpans: { start: number; end: number }[] = [];
  protectSelection(): boolean {
    if (this.selectionInvalid || this.selection.scope !== 'selection' || this.protectedSpans.length >= 100) return false;
    const { start, end } = this.selection;
    if (this.protectedSpans.some(span => span.start < end && span.end > start)) return false;
    this.protectedSpans.push({ start, end }); this.invalidate(); return true;
  }
  clearProtection(): void { if (this.protectedSpans.length) { this.protectedSpans.length = 0; this.invalidate(); } }
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  invalidateRevision(): void { this.invalidate(); }

  setSelection(start: number, end: number): boolean {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || !isUtf16Boundary(this.input, start) || !isUtf16Boundary(this.input, end)) {
      if (!this.selectionInvalid) this.invalidate(); this.selectionInvalid = true; return false;
    }
    const selection: OperationCommand['selection'] = end > start ? { scope: 'selection', start, end } : { scope: 'document' };
    if (this.selectionInvalid || JSON.stringify(selection) !== JSON.stringify(this.selection)) { this.selection = selection; this.selectionInvalid = false; this.invalidate(); }
    return true;
  }
  selectedInput(): string { return this.selection.scope === 'selection' ? this.input.slice(this.selection.start, this.selection.end) : this.input; }
  context(maximum = 4000): string | undefined {
    if (this.selection.scope === 'document') return undefined;
    if (!Number.isSafeInteger(maximum)) throw new Error('Invalid context limit');
    const maximumPoints = Math.max(0, Math.min(4000, Math.floor(maximum)));
    if (maximumPoints < 2) return '';
    const beforeBudget = Math.floor((maximumPoints - 2) / 2);
    const before = beforeBudget ? Array.from(this.input.slice(0, this.selection.start)).slice(-beforeBudget).join('') : '';
    const after = Array.from(this.input.slice(this.selection.end)).slice(0, Math.ceil((maximumPoints - 2) / 2)).join('');
    return before || after ? `${before}\n\n${after}` : '';
  }
  snapshot(): { input: string; revisionId: string; selection: OperationCommand['selection']; context?: string } {
    if (this.selectionInvalid) throw new Error('Invalid selection');
    const context = this.context();
    return { input: this.input, revisionId: this.revisionId, selection: structuredClone(this.selection), ...(context ? { context } : {}) };
  }

  count(): number { return codePointLength(this.input); }
  withinLimit(surface: 'panel' | 'web', limit: number = INPUT_LIMITS[surface]): boolean { return this.count() <= limit; }
  mainText(): string { const result = this.result; return result && 'text' in result ? result.text : ''; }
  setMode(mode: 'correction' | 'translation'): void { if (this.mode !== mode) { this.mode = mode; this.invalidate(); } }

  setInput(input: string): void {
    if (input === this.input) return;
    this.input = input;
    this.protectedSpans.length = 0;
    this.selection = { scope: 'document' }; this.selectionInvalid = false;
    this.invalidate();
  }

  setPreferences(preferences: Preferences): void {
    const value = PreferencesSchema.parse(preferences);
    if (JSON.stringify(this.preferences) === JSON.stringify(value)) return;
    this.preferences = structuredClone(value);
    this.invalidate();
  }

  publish(result: OperationResult, operationId?: string): boolean {
    if (result.revisionId !== this.revisionId) return false;
    if (result.kind === 'alternatives') { this.alternatives = structuredClone(result); this.alternativesOperationId = operationId; return true; }
    if (result.kind === 'explanation') {
      if (this.result?.kind !== 'correction' || this.result.recommendationId !== result.recommendationId || this.resultStale) return false;
      this.explanation = result; this.explanationStale = false; return true;
    }
    if (result.kind === 'translation' && result.recommendationId && this.result?.kind === 'correction') {
      if (result.recommendationId !== this.result.recommendationId) return false;
      this.nativeResult = result; this.nativeStale = false; return true;
    }
    if (result.kind === 'correction') {
      if (this.correctionBase?.recommendationId === result.recommendationId && this.correctionBase.revisionId === result.revisionId) return false;
      this.correctionBase = structuredClone(result); this.correctionOriginal = this.selectedInput(); this.rejectedGroups.clear(); this.recommendationOperationId = operationId;
      this.alternatives = undefined; this.alternativesOperationId = undefined; this.selectedAlternativeId = undefined;
      this.explanationStale = this.explanation !== undefined;
    }
    this.result = result;
    this.primaryOperationId = operationId;
    this.nativeResult = undefined;
    this.nativeStale = false;
    this.resultStale = false;
    return true;
  }

  clear(): void {
    this.input = '';
    this.protectedSpans.length = 0;
    this.selection = { scope: 'document' }; this.selectionInvalid = false;
    this.result = undefined;
    this.primaryOperationId = undefined;
    this.nativeResult = undefined;
    this.nativeStale = false; this.correctionBase = undefined; this.correctionOriginal = ''; this.rejectedGroups.clear(); this.recommendationOperationId = undefined;
    this.alternatives = undefined; this.alternativesOperationId = undefined; this.selectedAlternativeId = undefined;
    this.explanation = undefined; this.explanationStale = false;
    this.originals.length = 0;
    this.resultStale = false;
    this.revisionId = crypto.randomUUID();
    for (const listener of this.listeners) listener();
  }

  private invalidate(): void {
    this.revisionId = crypto.randomUUID();
    this.alternatives = undefined; this.alternativesOperationId = undefined; this.selectedAlternativeId = undefined;
    this.resultStale = this.result !== undefined;
    this.explanationStale = this.explanation !== undefined;
    for (const listener of this.listeners) listener();
  }
}
