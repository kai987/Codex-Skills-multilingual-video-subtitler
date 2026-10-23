import type { GrammarReport } from "@mvl/shared";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { loadSiteData, type BuildManifest } from "./data.js";
import { messages, type UiLanguage } from "./i18n/index.js";

type Sentence = GrammarReport["sentences"][number];
type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "kotoba-atlas.preferences.v1";
const UI_LANGUAGES: UiLanguage[] = ["zh-CN", "ja-JP", "en"];
const THEMES: Theme[] = ["system", "light", "dark"];

function initialParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function initialUiLanguage(): UiLanguage {
  const value = initialParam("ui");
  return UI_LANGUAGES.includes(value as UiLanguage)
    ? (value as UiLanguage)
    : "zh-CN";
}

function initialTheme(): Theme {
  const value = initialParam("theme");
  if (THEMES.includes(value as Theme)) return value as Theme;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as { theme?: unknown };
    return THEMES.includes(stored.theme as Theme)
      ? (stored.theme as Theme)
      : "system";
  } catch {
    return "system";
  }
}

function formatTime(value: number | null): string {
  if (value === null) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sentenceSearchText(sentence: Sentence): string {
  return [
    sentence.text,
    sentence.reading ?? "",
    sentence.translation ?? "",
    ...sentence.grammar.flatMap((grammar) => [
      grammar.surface,
      grammar.pattern,
      grammar.meaning,
      grammar.explanation,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function App() {
  const [report, setReport] = useState<GrammarReport | null>(null);
  const [manifest, setManifest] = useState<BuildManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(initialUiLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [query, setQuery] = useState(() => initialParam("q") ?? "");
  const [language, setLanguage] = useState(
    () => initialParam("language") ?? "all",
  );
  const [level, setLevel] = useState(() => initialParam("level") ?? "all");
  const [selectedId, setSelectedId] = useState(
    () => initialParam("sentence") ?? "",
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const t = messages[uiLanguage];

  useEffect(() => {
    let active = true;
    void loadSiteData()
      .then((data) => {
        if (!active) return;
        setReport(data.report);
        setManifest(data.manifest);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLanguage;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
    const params = new URLSearchParams();
    if (uiLanguage !== "zh-CN") params.set("ui", uiLanguage);
    if (theme !== "system") params.set("theme", theme);
    if (query !== "") params.set("q", query);
    if (language !== "all") params.set("language", language);
    if (level !== "all") params.set("level", level);
    if (selectedId !== "") params.set("sentence", selectedId);
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${suffix}`,
    );
  }, [language, level, query, selectedId, theme, uiLanguage]);

  const levels = useMemo(() => {
    if (report === null) return [];
    return [
      ...new Set(
        report.sentences.flatMap((sentence) =>
          sentence.grammar.map(
            (grammar) => `${grammar.levelSystem}:${grammar.level}`,
          ),
        ),
      ),
    ].toSorted();
  }, [report]);

  const filtered = useMemo(() => {
    if (report === null) return [];
    return report.sentences.filter((sentence) => {
      if (
        language !== "all" &&
        sentence.language !== language &&
        !sentence.languages.includes(language as Sentence["language"])
      ) {
        return false;
      }
      if (
        level !== "all" &&
        !sentence.grammar.some(
          (grammar) => `${grammar.levelSystem}:${grammar.level}` === level,
        )
      ) {
        return false;
      }
      return (
        deferredQuery === "" ||
        sentenceSearchText(sentence).includes(deferredQuery)
      );
    });
  }, [deferredQuery, language, level, report]);

  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((sentence) => sentence.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? "");
    }
  }, [filtered, selectedId]);

  const selected =
    filtered.find((sentence) => sentence.id === selectedId) ??
    filtered[0] ??
    null;

  const selectSentence = (sentence: Sentence): void => {
    setSelectedId(sentence.id);
    if (videoRef.current !== null && sentence.start !== null) {
      videoRef.current.currentTime = sentence.start;
    }
  };

  const clearFilters = (): void => {
    setQuery("");
    setLanguage("all");
    setLevel("all");
  };

  if (error !== null) {
    return (
      <main className="status-screen" role="alert">
        <p className="eyebrow">Kotoba Atlas</p>
        <h1>{t.loadError}</h1>
        <code>{error}</code>
      </main>
    );
  }
  if (report === null || manifest === null) {
    return (
      <main className="status-screen" aria-live="polite">
        <p className="eyebrow">Kotoba Atlas</p>
        <h1>{t.loading}</h1>
      </main>
    );
  }

  const title = report.source.title ?? "Multilingual Grammar Study";
  const selectedPosition =
    selected === null
      ? 0
      : report.sentences.findIndex((item) => item.id === selected.id) + 1;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#reader" aria-label="Kotoba Atlas home">
          <span>Kotoba Atlas</span>
          <small>{t.tagline}</small>
        </a>
        <nav aria-label="Primary">
          <a href="#overview">{t.overview}</a>
          <a className="active" href="#reader">
            {t.grammarNotes}
          </a>
          <a href="#timeline">{t.timeline}</a>
        </nav>
        <div className="top-controls">
          <label>
            <span className="sr-only">UI language</span>
            <select
              data-testid="ui-language"
              aria-label="UI language"
              value={uiLanguage}
              onChange={(event) =>
                setUiLanguage(event.target.value as UiLanguage)
              }
            >
              <option value="zh-CN">中</option>
              <option value="ja-JP">日</option>
              <option value="en">EN</option>
            </select>
          </label>
          <label>
            <span className="sr-only">{t.theme}</span>
            <select
              data-testid="theme"
              aria-label={t.theme}
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="system">{t.system}</option>
              <option value="light">{t.light}</option>
              <option value="dark">{t.dark}</option>
            </select>
          </label>
        </div>
      </header>

      <div className="workspace">
        <aside className="filter-rail" id="overview">
          <section className="course-summary">
            <p className="eyebrow">{t.context}</p>
            <h1>{title}</h1>
            <div className="progress-label">
              <span>{t.progress}</span>
              <strong>100%</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span />
            </div>
            <p className="muted">
              {report.summary.sentenceCount} {t.sentence} ·{" "}
              {report.summary.grammarPointCount} {t.grammarNotes}
            </p>
          </section>

          <details open className="filters-panel">
            <summary>{t.filters}</summary>
            <div className="filter-fields">
              <label>
                <span>{t.search}</span>
                <input
                  data-testid="search"
                  type="search"
                  value={query}
                  placeholder={t.searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label>
                <span>{t.language}</span>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <option value="all">{t.all}</option>
                  {report.languages.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t.level}</span>
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                >
                  <option value="all">{t.all}</option>
                  {levels.map((item) => (
                    <option key={item} value={item}>
                      {item.replace(":", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <p className="filter-count" aria-live="polite">
                {t.filterSummary(filtered.length, report.sentences.length)}
              </p>
              <button
                className="secondary-button"
                type="button"
                onClick={clearFilters}
              >
                {t.clearFilters}
              </button>
            </div>
          </details>

          <ol className="sentence-index" aria-label={t.sentences}>
            {filtered.map((sentence, index) => (
              <li key={sentence.id}>
                <button
                  type="button"
                  className={sentence.id === selected?.id ? "selected" : ""}
                  onClick={() => selectSentence(sentence)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{sentence.text}</strong>
                  <small>{formatTime(sentence.start)}</small>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className="reader" id="reader">
          {selected === null ? (
            <div className="empty-state">
              <p>{t.noMatches}</p>
              <button type="button" onClick={clearFilters}>
                {t.clearFilters}
              </button>
            </div>
          ) : (
            <article className="sentence-study">
              <header className="sentence-meta">
                <p>
                  {t.sentence} {String(selectedPosition).padStart(2, "0")} /{" "}
                  {report.sentences.length}
                </p>
                <p>
                  {formatTime(selected.start)}–{formatTime(selected.end)} ·{" "}
                  {selected.languages.join(" · ")}
                </p>
              </header>
              {manifest.videoRelativePath === null ? null : (
                <video
                  ref={videoRef}
                  className="source-video"
                  controls
                  preload="metadata"
                  src={manifest.videoRelativePath}
                />
              )}
              <div className="sentence-display">
                <p className="reading-line">
                  {selected.reading ?? t.noReading}
                </p>
                <h2>{selected.text}</h2>
                <div className="grammar-strip" aria-label={t.grammarNotes}>
                  {selected.grammar.map((grammar, index) => (
                    <a
                      key={grammar.id}
                      href={`#${grammar.id}`}
                      data-accent={index % 4}
                    >
                      <strong>{grammar.surface}</strong>
                      <span>{grammar.category}</span>
                    </a>
                  ))}
                </div>
              </div>

              <dl className="translation-block">
                <div>
                  <dt>{t.translation}</dt>
                  <dd>{selected.translation ?? t.noTranslation}</dd>
                </div>
                <div>
                  <dt>{t.reading}</dt>
                  <dd>{selected.reading ?? t.noReading}</dd>
                </div>
              </dl>

              {selected.needsReview ? (
                <p className="warning" role="status">
                  {t.reconstructionReview}
                </p>
              ) : null}
              {selected.reconstructionConfidence < 0.75 ? (
                <p className="warning" role="status">
                  {t.lowConfidence}
                </p>
              ) : null}

              <section
                className="structure-line"
                aria-labelledby="structure-title"
              >
                <h3 id="structure-title">{t.grammarNotes}</h3>
                <div>
                  {selected.grammar.map((grammar) => (
                    <span key={grammar.id}>
                      <strong>{grammar.surface}</strong>
                      <small>
                        {grammar.levelSystem} {grammar.level}
                      </small>
                    </span>
                  ))}
                </div>
              </section>
            </article>
          )}
        </main>

        <aside className="detail-panel" aria-label={t.grammarNotes}>
          <div className="detail-heading">
            <p className="eyebrow">{t.grammarNotes}</p>
            <strong>{selected?.grammar.length ?? 0}</strong>
          </div>
          {selected?.grammar.map((grammar, index) => (
            <article
              className="grammar-card"
              id={grammar.id}
              key={grammar.id}
              data-accent={index % 4}
            >
              <header>
                <span className="accent-dot" />
                <div>
                  <h3>{grammar.surface}</h3>
                  <p>
                    {grammar.pattern} · {grammar.levelSystem} {grammar.level}
                  </p>
                </div>
              </header>
              <p>{grammar.explanation}</p>
              <dl>
                <div>
                  <dt>{t.formation}</dt>
                  <dd>{grammar.formation}</dd>
                </div>
                <div>
                  <dt>{t.meaning}</dt>
                  <dd>{grammar.meaning}</dd>
                </div>
                <div>
                  <dt>{t.nuance}</dt>
                  <dd>{grammar.nuance ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t.confidence}</dt>
                  <dd>{Math.round(grammar.confidence * 100)}%</dd>
                </div>
              </dl>
              {grammar.confidence < 0.7 ? (
                <p className="warning">{t.lowConfidence}</p>
              ) : null}
              <h4>{t.examples}</h4>
              {grammar.examples.length === 0 ? (
                <p className="muted">{t.noExamples}</p>
              ) : (
                <ul>
                  {grammar.examples.map((example) => (
                    <li key={`${grammar.id}-${example.text}`}>
                      <strong>{example.text}</strong>
                      <span>{example.translation ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          {selected === null ? null : (
            <section className="vocabulary-panel">
              <h3>{t.vocabulary}</h3>
              {selected.vocabulary.length === 0 ? (
                <p className="muted">{t.noVocabulary}</p>
              ) : (
                <dl>
                  {selected.vocabulary.map((word) => (
                    <div key={`${word.language}-${word.surface}`}>
                      <dt>{word.surface}</dt>
                      <dd>
                        {word.reading ?? "—"} · {word.meaning}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          )}
        </aside>
      </div>

      <footer className="timeline" id="timeline" aria-label={t.timeline}>
        <strong>{t.timeline}</strong>
        <ol>
          {filtered.map((sentence, index) => (
            <li key={sentence.id}>
              <button
                type="button"
                className={sentence.id === selected?.id ? "selected" : ""}
                onClick={() => selectSentence(sentence)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{sentence.text}</strong>
                <small>{formatTime(sentence.start)}</small>
              </button>
            </li>
          ))}
        </ol>
      </footer>
    </div>
  );
}
