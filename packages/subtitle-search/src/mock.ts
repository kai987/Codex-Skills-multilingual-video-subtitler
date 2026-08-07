import type {
  SubtitleSearchAdapter,
  SubtitleSearchCandidate,
  SubtitleSearchQuery,
} from "./types.js";

export class MockSubtitleSearchAdapter implements SubtitleSearchAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly #candidates: readonly SubtitleSearchCandidate[];
  readonly #failure: Error | null;

  constructor(
    options: {
      id?: string;
      displayName?: string;
      candidates?: readonly SubtitleSearchCandidate[];
      failure?: Error;
    } = {},
  ) {
    this.id = options.id ?? "mock";
    this.displayName = options.displayName ?? "Mock subtitle source";
    this.#candidates = options.candidates ?? [];
    this.#failure = options.failure ?? null;
  }

  search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]> {
    void query;
    if (this.#failure !== null) return Promise.reject(this.#failure);
    return Promise.resolve(this.#candidates);
  }
}
