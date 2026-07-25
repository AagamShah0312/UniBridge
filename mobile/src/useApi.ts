import { useCallback, useEffect, useState } from 'react'

/**
 * Minimal fetch-on-mount hook with refresh + error state.
 * ponytail: the app has no server-cache needs yet, so this stays ~40 lines instead of pulling
 * react-query into the bundle. Swap it in if/when we need caching or mutations.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setData(await fetcher())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong')
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, refreshing, refresh: () => void load(true) }
}
