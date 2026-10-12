import { useCallback, useEffect, useRef, useState } from 'react';

export function loadErrorText(error: unknown): string {
  return (error as { status?: number } | null)?.status === 401 ? 'Вход устарел, войди снова' : 'Не удалось загрузить. Проверь соединение.';
}

/** Загрузка данных экрана: повторяется при смене deps, устаревшие ответы отбрасываются */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const run = useRef(0);

  const reload = useCallback(() => {
    const mine = ++run.current;
    setError('');
    setData(null);
    load().then(
      (value) => { if (mine === run.current) setData(value); },
      (e) => { if (mine === run.current) setError(loadErrorText(e)); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
    return () => { run.current += 1; };
  }, [reload]);

  return { data, error, reload };
}
