import { OperationResultSchema, isUtf16Boundary, type OperationResult } from '@klaro/contracts';
import type { AiTask } from './provider';

export function validateResult(task: AiTask, candidate: unknown): OperationResult | undefined {
  const parsed = OperationResultSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const result = parsed.data;
  if (result.kind !== task.resultKind || result.revisionId !== task.command.revisionId || result.language !== task.targetLanguage) return undefined;
  if ('recommendationId' in result && task.recommendationId && result.recommendationId !== task.recommendationId) return undefined;
  const selectionStart = task.command.selection.scope === 'selection' ? task.command.selection.start : 0;
  const selectionEnd = task.command.selection.scope === 'selection' ? task.command.selection.end : task.command.input.length;
  const original = task.command.input.slice(selectionStart, selectionEnd);
  const terms = task.command.protectedSpans.filter(span => span.start < selectionEnd && span.end > selectionStart).map(span => task.command.input.slice(Math.max(span.start, selectionStart), Math.min(span.end, selectionEnd)));
  if (result.kind === 'translation' && task.command.operationType === 'translation' && task.promptVersion === 'language-v5') {
    if (terms.some(term => !result.text.includes(term))) return undefined;
    if (JSON.stringify((original.match(/\p{Nd}+/gu) ?? []).sort()) !== JSON.stringify((result.text.match(/\p{Nd}+/gu) ?? []).sort())) return undefined;
    const paragraphs = (text: string) => text.trim().split(/\r?\n[\t ]*\r?\n+/).length;
    if (paragraphs(original) !== paragraphs(result.text)) return undefined;
  }
  if (['correction', 'alternatives'].includes(result.kind)) {
    const texts = result.kind === 'alternatives' ? result.alternatives.map(value => value.text) : [result.kind === 'correction' ? result.text : ''];
    if (texts.some(text => terms.some(term => !text.includes(term)))) return undefined;
  }
  if (result.kind === 'correction') {
    if ((task.promptVersion === 'language-v3' || task.promptVersion === 'language-v4' || task.promptVersion === 'language-v5') && JSON.stringify((original.match(/\p{Nd}+/gu) ?? []).sort()) !== JSON.stringify((result.text.match(/\p{Nd}+/gu) ?? []).sort())) return undefined;
    if (new Set(result.editGroups.map(group => group.groupId)).size !== result.editGroups.length) return undefined;
    const edits = result.editGroups.flatMap(group => group.edits).sort((a, b) => a.span.start - b.span.start);
    if (!edits.length && !result.warnings.includes('no-changes')) return undefined;
    let end = 0;
    for (const edit of edits) {
      if (edit.span.start < end || !isUtf16Boundary(original, edit.span.start) || !isUtf16Boundary(original, edit.span.end) || original.slice(edit.span.start, edit.span.end) !== edit.original) return undefined;
      const absoluteStart = edit.span.start + selectionStart;
      const absoluteEnd = edit.span.end + selectionStart;
      if (task.command.protectedSpans.some(span => absoluteStart < span.end && absoluteEnd > span.start || absoluteStart === absoluteEnd && absoluteStart > span.start && absoluteStart < span.end)) return undefined;
      end = edit.span.end;
    }
    let reconstructed = original;
    for (const edit of [...edits].reverse()) reconstructed = reconstructed.slice(0, edit.span.start) + edit.replacement + reconstructed.slice(edit.span.end);
    if (reconstructed !== result.text) return undefined;
  }
  if (result.kind === 'alternatives' && new Set(result.alternatives.map(value => value.recommendationId)).size !== result.alternatives.length) return undefined;
  if (result.kind === 'lexical') {
    const lexical = task.command.lexical;
    if (!lexical || result.section !== lexical.section || result.entryId !== lexical.entryId || result.senseId !== lexical.senseId || result.sourceVersion !== lexical.sourceVersion) return undefined;
    if (result.originKind !== (task.command.operationType === 'source-translation' ? 'machine-translation' : 'generated-unverified')) return undefined;
  }
  return result;
}
