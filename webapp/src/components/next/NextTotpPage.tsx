// NodeWarden Next (issue #16, slice 5): verification codes — every TOTP
// login with a live code, countdown ring, and one-click copy.
import { useEffect, useState } from 'preact/hooks';
import { calcTotpNow, type TotpCodeResult } from '@/lib/crypto';
import { TypeIcon } from '@/components/vault/vault-page-helpers';
import type { SearchEntry } from '@/lib/next/search';
import type { Cipher } from '@/lib/types';

const STR = {
  empty: 'No items with one-time codes yet. Add a TOTP secret to a login and it appears here.',
  copy: 'Copy code',
};

interface NextTotpPageProps {
  entries: SearchEntry[];
  cipherById: Map<string, Cipher>;
  onCopyValue: (value: string, label: string, entryId?: string) => void;
  copiedId: string | null;
}

export default function NextTotpPage(props: NextTotpPageProps) {
  const totpEntries = props.entries.filter((e) => e.hasTotp && !e.deleted && !e.archived);
  const [codes, setCodes] = useState<Map<string, TotpCodeResult>>(new Map());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = new Map<string, TotpCodeResult>();
      for (const entry of totpEntries) {
        const secret = props.cipherById.get(entry.id)?.login?.decTotp || '';
        if (!secret) continue;
        const result = await calcTotpNow(secret);
        if (result) next.set(entry.id, result);
      }
      if (alive) setCodes(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [props.entries, props.cipherById]);

  return (
    <div className="nx-list" role="list">
      {totpEntries.length === 0 && <div className="nx-empty">{STR.empty}</div>}
      {totpEntries.map((entry) => {
        const live = codes.get(entry.id);
        return (
          <div
            key={entry.id}
            role="listitem"
            className={`nx-row${entry.id === props.copiedId ? ' is-copied' : ''}`}
            onClick={() => live && props.onCopyValue(live.code, 'Code', entry.id)}
            title={STR.copy}
          >
            <span className="ico"><TypeIcon type={entry.type} /></span>
            <span className="main">
              <span className="title">{entry.name}</span>
              <span className="sub">{entry.sub}</span>
            </span>
            <span className="meta">
              {entry.id === props.copiedId && <span className="nx-badge ok">✓</span>}
              {live && (
                <span className="nx-totp" style={{ fontSize: 'var(--nx-text-lg)' }}>
                  <span style={{ letterSpacing: '0.08em' }}>{live.code}</span>
                  <span className="ring" style={{ '--ring': `${Math.round((live.remain / live.period) * 100)}%` }} />
                  <span style={{ fontSize: 'var(--nx-text-sm)' }}>{live.remain}s</span>
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
