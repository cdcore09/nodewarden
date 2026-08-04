// NodeWarden Next (issue #16, slice 5): security audit — the J5 fix-loop.
// Scan (HIBP k-anonymity + local weak/reuse), filter by finding, and fix a
// password without leaving the findings list: Fix opens the Next editor with
// the generator ready; on save the finding resolves in place.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ShieldAlert, ShieldCheck, ShieldQuestion, KeyRound } from 'lucide-preact';
import {
  getPasswordSecurityState, startPasswordSecurityScan, subscribePasswordSecurityState,
} from '@/lib/password-security-cache';
import type { SearchEntry } from '@/lib/next/search';
import type { Cipher } from '@/lib/types';

const STR = {
  intro: 'Passwords are checked locally and against Have I Been Pwned using k-anonymity — full passwords never leave this device.',
  scan: 'Check password security',
  rescan: 'Re-check',
  scanning: (done: number, total: number) => `Checking ${done} of ${total}…`,
  lastChecked: (d: string) => `Last checked ${d}`,
  scanError: 'The breach service was unreachable; local checks still ran.',
  exposed: 'Exposed',
  reused: 'Reused',
  weak: 'Weak',
  all: 'All',
  fix: 'Fix',
  fixed: 'fixed',
  clean: 'No findings — your passwords look strong.',
  ready: 'Run a check to see weak, reused, and breached passwords.',
  breachedTimes: (n: number) => `${n.toLocaleString()}×`,
};

type Filter = 'all' | 'exposed' | 'reused' | 'weak';

// Mirrors the stock page's cache key (PasswordSecurityPage.tsx:16).
function vaultFingerprint(ciphers: Cipher[]): string {
  return JSON.stringify(ciphers.map((cipher) => ({
    id: cipher.id,
    type: cipher.type,
    revisionDate: cipher.revisionDate || '',
    deletedDate: cipher.deletedDate || (cipher as { deletedAt?: string | null }).deletedAt || '',
  })));
}

interface NextAuditPageProps {
  ciphers: Cipher[];
  entries: SearchEntry[];
  onFix: (cipherId: string) => void;
  fixedIds: Set<string>;
}

export default function NextAuditPage(props: NextAuditPageProps) {
  const fingerprint = useMemo(() => vaultFingerprint(props.ciphers), [props.ciphers]);
  const [state, setState] = useState(() => getPasswordSecurityState(fingerprint));
  const [filter, setFilter] = useState<Filter>('all');
  // The scan cache is keyed to the vault fingerprint, so fixing a finding
  // (which edits the vault) would wipe the report mid-loop. Keep the last
  // report as a local snapshot so findings resolve IN PLACE (J5 criterion);
  // Re-check refreshes against the current vault.
  const [snapshot, setSnapshot] = useState<{ report: NonNullable<typeof state.report>; scannedAt: number | null } | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = getPasswordSecurityState(fingerprint);
      setState(next);
      if (next.report) setSnapshot({ report: next.report, scannedAt: next.scannedAt });
    };
    sync();
    return subscribePasswordSecurityState(sync);
  }, [fingerprint]);

  const entryById = useMemo(() => {
    const map = new Map<string, SearchEntry>();
    for (const entry of props.entries) map.set(entry.id, entry);
    return map;
  }, [props.entries]);

  const report = state.report || snapshot?.report || null;
  const scannedAt = state.report ? state.scannedAt : snapshot?.scannedAt || null;
  const findings = useMemo(
    () => (report?.items || []).filter(
      (item) => (item.exposedCount || 0) > 0 || item.reusedCount > 1 || item.weak
    ),
    [report]
  );
  const filtered = findings.filter((item) =>
    filter === 'all' ? true
      : filter === 'exposed' ? (item.exposedCount || 0) > 0
      : filter === 'reused' ? item.reusedCount > 1
      : item.weak
  );

  const scanning = state.scanning;

  return (
    <div className="nx-list">
      <div className="nx-help" style={{ maxWidth: '64ch', marginBottom: 'var(--nx-sp-3)' }}>{STR.intro}</div>

      <div style={{ display: 'flex', gap: 'var(--nx-sp-2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--nx-sp-4)' }}>
        <button type="button" className="nx-btn" disabled={scanning} onClick={() => startPasswordSecurityScan(fingerprint, props.ciphers)}>
          {report ? STR.rescan : STR.scan}
        </button>
        {scanning && <span className="nx-help">{STR.scanning(state.progress.checked, state.progress.total)}</span>}
        {!scanning && scannedAt && (
          <span className="nx-help">{STR.lastChecked(new Date(scannedAt).toLocaleString())}</span>
        )}
        {state.scanError && <span className="nx-help warn">{STR.scanError}</span>}
      </div>

      {report && (
        <div style={{ display: 'flex', gap: 'var(--nx-sp-2)', flexWrap: 'wrap', marginBottom: 'var(--nx-sp-4)' }}>
          {([
            ['all', STR.all, findings.length],
            ['exposed', STR.exposed, report.exposedCount],
            ['reused', STR.reused, report.reusedCount],
            ['weak', STR.weak, report.weakCount],
          ] as Array<[Filter, string, number]>).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className="nx-btn ghost"
              aria-pressed={filter === key}
              style={filter === key ? { borderColor: 'var(--nx-accent-line)', color: 'var(--nx-accent)', background: 'var(--nx-accent-soft)' } : undefined}
              onClick={() => setFilter(key)}
            >
              {label} <span className="nx-kbd" style={{ minWidth: 22 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {report && findings.length === 0 && !scanning && (
        <div className="nx-empty" style={{ color: 'var(--nx-ok)' }}>
          <ShieldCheck size={20} /> {STR.clean}
        </div>
      )}
      {!report && !scanning && (
        <div className="nx-empty"><ShieldQuestion size={20} /> {STR.ready}</div>
      )}

      {filtered.map((item) => {
        const entry = entryById.get(item.cipherId);
        const fixed = props.fixedIds.has(item.cipherId);
        return (
          <div key={item.cipherId} className="nx-row" style={fixed ? { opacity: 0.45 } : undefined}>
            <span className="ico"><ShieldAlert size={14} /></span>
            <span className="main">
              <span className="title" style={fixed ? { textDecoration: 'line-through' } : undefined}>
                {entry?.name || item.cipherId}
              </span>
              <span className="sub">{entry?.sub || ''}</span>
            </span>
            <span className="meta">
              {fixed ? (
                <span className="nx-badge ok">{STR.fixed}</span>
              ) : (
                <>
                  {(item.exposedCount || 0) > 0 && <span className="nx-badge danger">{STR.exposed} {STR.breachedTimes(item.exposedCount || 0)}</span>}
                  {item.reusedCount > 1 && <span className="nx-badge warn">{STR.reused}</span>}
                  {item.weak && <span className="nx-badge warn">{STR.weak}</span>}
                  <button
                    type="button"
                    className="nx-btn ghost"
                    style={{ height: 26, padding: '0 10px', fontSize: 'var(--nx-text-sm)' }}
                    onClick={() => props.onFix(item.cipherId)}
                  >
                    <KeyRound size={12} /> {STR.fix}
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
