import { useMemo } from "react";

import type { SessionMeta } from "@/types";

interface UseSessionSearchOptions {
  sessions: SessionMeta[];
  providerFilter: string;
  query: string;
}

interface UseSessionSearchResult {
  filteredSessions: SessionMeta[];
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildSearchText(session: SessionMeta) {
  return normalizeSearchValue(
    [
      session.sessionId,
      session.title,
      session.summary,
      session.projectDir,
      session.sourcePath,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function sortByActivity(sessions: SessionMeta[]) {
  return [...sessions].sort((left, right) => {
    const leftTimestamp = left.lastActiveAt ?? left.createdAt ?? 0;
    const rightTimestamp = right.lastActiveAt ?? right.createdAt ?? 0;
    return rightTimestamp - leftTimestamp;
  });
}

export function useSessionSearch({
  sessions,
  providerFilter,
  query,
}: UseSessionSearchOptions): UseSessionSearchResult {
  const filteredByProvider = useMemo(() => {
    const base =
      providerFilter === "all"
        ? sessions
        : sessions.filter((session) => session.providerId === providerFilter);

    return sortByActivity(base);
  }, [providerFilter, sessions]);

  const normalizedQuery = normalizeSearchValue(query);

  const filteredSessions = useMemo(() => {
    if (!normalizedQuery) {
      return filteredByProvider;
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return filteredByProvider;
    }

    return filteredByProvider.filter((session) => {
      const haystack = buildSearchText(session);
      return terms.every((term) => haystack.includes(term));
    });
  }, [filteredByProvider, normalizedQuery]);

  return { filteredSessions };
}
