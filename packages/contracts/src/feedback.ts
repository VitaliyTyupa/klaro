import { z } from 'zod';

export const FeedbackReasonSchema = z.enum(['helpful', 'meaning', 'grammar', 'translation', 'style', 'other']);
export const OperationFeedbackSchema = z.strictObject({ reason: FeedbackReasonSchema });
export type FeedbackReason = z.infer<typeof FeedbackReasonSchema>;
