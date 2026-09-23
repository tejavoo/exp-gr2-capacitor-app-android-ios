export interface LogEntry {
  timestamp: number;
  level: 'log' | 'debug' | 'warn' | 'error' | 'api' | 'apiResponse' | 'apiError';
  message: string;
  data?: any;
  duration?: number;
}

class Logger {
  private entries: LogEntry[] = [];
  private maxEntries = 500;
  private listeners: ((entry: LogEntry) => void)[] = [];

  log(message: string, data?: any): void {
    this.add('log', message, data);
    console.log(`[GR] ${message}`, data || '');
  }

  debug(message: string, data?: any): void {
    this.add('debug', message, data);
    console.debug(`[GR] ${message}`, data || '');
  }

  warn(message: string, data?: any): void {
    this.add('warn', message, data);
    console.warn(`[GR] ${message}`, data || '');
  }

  error(message: string, err?: any): void {
    this.add('error', message, err);
    console.error(`[GR] ${message}`, err || '');
  }

  api(method: string, path: string, body?: string | null): void {
    const msg = body ? `${method} /${path}  ${body}` : `${method} /${path}`;
    this.add('api', msg, { method, path, body: body || null });
    console.log(`[API] ${msg}`, body ? `Body: ${body}` : '');
  }

  apiResponse(path: string, status: number, data: any, duration: number): void {
    const msg = `${status} /${path} (${duration}ms)`;
    this.add('apiResponse', msg, { path, status, data, duration }, duration);
    console.log(`[API ✓] ${msg}`);
  }

  apiError(path: string, err: any, duration: number): void {
    const msg = `ERROR /${path} (${duration}ms): ${err?.message ?? err}`;
    const errData = {
      path,
      code: err.code || err.name,
      message: err.message,
      duration,
    };
    this.add('apiError', msg, errData, duration);
    console.error(`[API ✗] ${msg}`, errData);
  }

  private add(level: LogEntry['level'], message: string, data?: any, duration?: number): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data,
      duration,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.listeners.forEach(fn => fn(entry));
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  getEntriesFiltered(level?: string, path?: string): LogEntry[] {
    return this.entries.filter(e => {
      if (level && e.level !== level) return false;
      if (path && e.data?.path && !e.data.path.includes(path)) return false;
      return true;
    });
  }

  clear(): void {
    this.entries = [];
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  exportCSV(): string {
    const headers = ['Timestamp', 'Level', 'Message', 'Duration (ms)', 'Details'];
    const rows = this.entries.map(e => [
      new Date(e.timestamp).toISOString(),
      e.level,
      e.message,
      e.duration?.toString() || '',
      e.data ? JSON.stringify(e.data) : '',
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return csv;
  }

  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== callback);
    };
  }
}

export const logger = new Logger();
