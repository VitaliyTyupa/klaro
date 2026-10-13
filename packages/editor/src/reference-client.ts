import type { ReferenceCard, ReferenceLanguage, ReferenceLookup, ReferenceSection, ReferenceSectionData, AiSupplement } from '@klaro/contracts';
export interface ReferencePort {
  supplement?(entryId: string, sourceVersion: string, section: ReferenceSection, targetLanguage: ReferenceLanguage, originKind: AiSupplement['originKind'], signal: AbortSignal, senseId?: string): Promise<AiSupplement | null>;
  report?(targetId: string, targetKind: 'reference' | 'supplement', reason: string, signal: AbortSignal): Promise<void>;
  lookup(language: ReferenceLanguage, query: string, signal: AbortSignal, offset?: number): Promise<ReferenceLookup>;
  card(id: string, version: string, native: ReferenceLanguage, signal: AbortSignal, offset?: number): Promise<ReferenceCard>;
  section(id: string, version: string, section: ReferenceSection, signal: AbortSignal): Promise<ReferenceSectionData>;
  availability(id: string, version: string, signal: AbortSignal): Promise<{ sections: { section: ReferenceSection; state: ReferenceSectionData['state'] }[] }>;
}
export class ApiReferenceClient implements ReferencePort {
  private lifetime = new AbortController();
  private readonly cache = new Map<string, ReferenceSectionData>();
  private readonly origin: string; private readonly headers: () => Record<string, string>; private readonly request: typeof fetch;
  constructor(origin: string, headers: () => Record<string, string>, request: typeof fetch = (input, init) => fetch(input, init)) { this.origin = origin; this.headers = headers; this.request = request; }
  suspend(): void { this.lifetime.abort(); this.lifetime = new AbortController(); this.cache.clear(); }
  private async get<T>(path: string, query: Record<string, string>, signal: AbortSignal): Promise<T> {
    const response = await this.request(`${this.origin}/v1/reference/${path}?${new URLSearchParams(query)}`, { headers: this.headers(), signal: AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(15000)]), credentials: this.origin ? 'omit' : 'same-origin', cache: 'no-store' });
    if (!response.ok) { if (response.status === 404) this.cache.clear(); throw new Error(response.status === 404 ? 'reference-unavailable' : 'reference-network-error'); }
    return await response.json() as T;
  }
  async supplement(entryId: string, sourceVersion: string, section: ReferenceSection, targetLanguage: ReferenceLanguage, originKind: AiSupplement['originKind'], signal: AbortSignal, senseId?: string): Promise<AiSupplement | null> { return (await this.get<{ supplement: AiSupplement | null }>('supplements', { entryId, sourceVersion, section, targetLanguage, originKind, ...(senseId ? { senseId } : {}) }, signal)).supplement; }
  async report(targetId: string, targetKind: 'reference' | 'supplement', reason: string, signal: AbortSignal): Promise<void> {
    const response = await this.request(`${this.origin}/v1/reference/reports`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId, targetKind, reason }), signal: AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(15000)]), credentials: this.origin ? 'omit' : 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 429 ? 'quota-exceeded' : 'unavailable');
  }
  lookup(language: ReferenceLanguage, query: string, signal: AbortSignal, offset = 0): Promise<ReferenceLookup> { return this.get('lookup', { language, query, offset: String(offset) }, signal); }
  card(id: string, sourceVersion: string, nativeLanguage: ReferenceLanguage, signal: AbortSignal, offset = 0): Promise<ReferenceCard> { return this.get(`entries/${id}`, { sourceVersion, nativeLanguage, offset: String(offset) }, signal); }
  availability(id: string, sourceVersion: string, signal: AbortSignal): Promise<{ sections: { section: ReferenceSection; state: ReferenceSectionData['state'] }[] }> { return this.get(`entries/${id}/sections`, { sourceVersion }, signal); }
  async section(id: string, sourceVersion: string, section: ReferenceSection, signal: AbortSignal): Promise<ReferenceSectionData> {
    signal.throwIfAborted(); const key = `${id}:${sourceVersion}:${section}`; const cached = this.cache.get(key); if (cached) return structuredClone(cached);
    const value = await this.get<ReferenceSectionData>(`entries/${id}/sections/${section}`, { sourceVersion }, signal);
    signal.throwIfAborted(); if (value.sourceVersion !== sourceVersion || value.section !== section) throw new Error('reference-network-error');
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!); this.cache.set(key, structuredClone(value)); return value;
  }
}
