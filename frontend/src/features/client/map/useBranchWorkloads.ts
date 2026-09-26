import { useEffect, useState } from 'react';
import { getBranchWorkload, type BranchWorkload } from '../../../api/client/clientApi';

export function useBranchWorkloads(branchIds: string[]) {
  const [workloads, setWorkloads] = useState<Record<string, BranchWorkload>>({});
  const idsKey = JSON.stringify(branchIds);
  useEffect(() => {
    const ids: string[] = JSON.parse(idsKey);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      const signal = controller.signal;
      const timeout = setTimeout(() => controller?.abort(), 8000);
      const next: Record<string, BranchWorkload> = {};
      // Bound concurrency; one slow/offline branch must not keep stale recommendations alive.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (!stopped && !signal.aborted && cursor < ids.length) {
          const id = ids[cursor++];
          try {
            const value = await getBranchWorkload(id, signal);
            if (value.branchId === id) next[id] = value;
          } catch { /* Missing data stays unknown until the next successful refresh. */ }
        }
      }));
      clearTimeout(timeout);
      if (!stopped) {
        setWorkloads(next);
        timer = setTimeout(poll, 15000);
      }
    };
    void poll();
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); };
  }, [idsKey]);
  return workloads;
}
