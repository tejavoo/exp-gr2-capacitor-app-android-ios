import { useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import type { LogEntry } from '../lib/logger';
import { showToast } from './Toast';
import { Diagnostics } from './Diagnostics';

type Filter = 'all' | 'api' | 'apiResponse' | 'apiError' | 'warn' | 'error';

const levelStyle: Record<string, { color: string; prefix: string }> = {
  log:         { color: '#8b949e', prefix: '   ' },
  debug:       { color: '#484f58', prefix: 'DBG' },
  warn:        { color: '#d29922', prefix: 'WRN' },
  error:       { color: '#f85149', prefix: 'ERR' },
  api:         { color: '#58a6ff', prefix: '→  ' },
  apiResponse: { color: '#3fb950', prefix: '←  ' },
  apiError:    { color: '#f85149', prefix: '✗  ' },
};

export function LogsViewer() {
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getEntries());
  const [filter, setFilter] = useState<Filter>('all');
  const [tail, setTail] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return logger.subscribe(e => setEntries(prev => [...prev.slice(-499), e]));
  }, []);

  useEffect(() => {
    if (tail && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, tail]);

  const visible = entries.filter(e => filter === 'all' || e.level === filter);

  const handleCopy = () => {
    const text = visible.map(e =>
      `[${new Date(e.timestamp).toISOString()}] ${e.level.padEnd(12)} ${e.message}`
    ).join('\n');
    navigator.clipboard.writeText(text);
    showToast('Logs copied', 'success');
  };

  const handleExport = () => {
    const blob = new Blob([logger.exportCSV()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gr-logs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported', 'success');
  };

  return (
    <div className="p-3 flex flex-col h-full gap-2" style={{ minHeight: 320 }}>
      <Diagnostics />
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className="cam-select" style={{ width: 'auto' }} aria-label="Filter logs">
          <option value="all">All ({entries.length})</option>
          <option value="api">Requests</option>
          <option value="apiResponse">Responses</option>
          <option value="apiError">API errors</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-cam-muted)' }}>
          <input type="checkbox" checked={tail} onChange={e => setTail(e.target.checked)} />
          Follow
        </label>
        <div className="flex gap-1.5 ml-auto">
          <button className="btn" onClick={handleCopy}>Copy</button>
          <button className="btn" onClick={handleExport}>CSV</button>
          <button className="btn" style={{ color: 'var(--color-cam-red)' }} onClick={() => { logger.clear(); setEntries([]); }}>Clear</button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 rounded-xl font-mono text-[11px] overflow-y-auto panel-scroll p-2"
        style={{ background: '#08080a', border: '1px solid var(--color-cam-border)', minHeight: 240 }}
      >
        {visible.length === 0 ? (
          <span style={{ color: 'var(--color-cam-dim)' }}>No log entries</span>
        ) : (
          visible.map((e, i) => {
            const s = levelStyle[e.level] ?? levelStyle.log;
            const time = new Date(e.timestamp).toLocaleTimeString('en', { hour12: false });
            return (
              <div key={i} className="leading-5 whitespace-pre-wrap break-all">
                <span style={{ color: '#4a4a52' }}>{time} </span>
                <span style={{ color: s.color }}>{s.prefix} {e.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
