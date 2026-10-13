import type { AiTask } from './provider';

export function taskInput(task: AiTask): Record<string, unknown> {
  const { command } = task;
  const original = command.selection.scope === 'selection' ? command.input.slice(command.selection.start, command.selection.end) : command.input;
  const start = command.selection.scope === 'selection' ? command.selection.start : 0;
  const end = command.selection.scope === 'selection' ? command.selection.end : command.input.length;
  const protectedTerms = command.protectedSpans.filter(span => span.start < end && span.end > start).map(span => command.input.slice(Math.max(span.start, start), Math.min(span.end, end)));
  const protectedSpans = command.protectedSpans.filter(span => span.start < end && span.end > start).map(span => ({ start: Math.max(span.start, start) - start, end: Math.min(span.end, end) - start }));
  const recommendation = (task.promptVersion === 'language-v4' || task.promptVersion === 'language-v5') && command.recommendation ? { recommendation: command.recommendation } : {};
  return { operation: command.operationType, stage: task.stageId, kind: task.resultKind, revisionId: command.revisionId, recommendationId: task.recommendationId ?? null, sourceLanguage: task.sourceLanguage, targetLanguage: task.targetLanguage, style: command.preferences.style, proficiency: command.preferences.proficiency, text: task.text, original, context: command.context ?? null, protectedTerms, ...((task.promptVersion === 'language-v3' || task.promptVersion === 'language-v4' || task.promptVersion === 'language-v5') ? { protectedSpans } : {}), ...recommendation, lexical: command.lexical ?? null };
}

export function inputTokenUpperBound(task: AiTask): number { return Buffer.byteLength(JSON.stringify(taskInput(task)), 'utf8') + 4096; }
