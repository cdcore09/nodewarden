// NodeWarden Next (issue #16, slice 5): verification codes — every TOTP
// login with a live code, countdown ring, and one-click copy.
import { useEffect, useState } from 'preact/hooks';
import { calcTotpNow, type TotpCodeResult } from '@/lib/crypto';
import { TypeIcon } from '@/components/vault/vault-page-helpers';
import WebsiteIcon from '@/components/vault/WebsiteIcon';
import type { SearchEntry } from '@/lib/next/search';
import type { Cipher } from '@/lib/types';

const STR = {
  intro: 'Live two-factor codes for every login that has a one-time-code secret. Each code rolls over on its own timer — click a card to copy the current one.',
  empty: 'No codes yet. Open a login, add its two-factor secret to the One-time code field, and the live code appears here.',
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
      <div className="nx-help totp-intro">{STR.intro}</div>
      {totpEntries.length === 0 && <div className="nx-empty">{STR.empty}</div>}
      <div className="totp-grid">
        {totpEntries.map((entry) => {
          const live = codes.get(entry.id);
          const cipher = props.cipherById.get(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              className={`totp-card${entry.id === props.copiedId ? ' is-copied' : ''}`}
              onClick={() => live && props.onCopyValue(live.code, 'Code', entry.id)}
              title={STR.copy}
            >
              <span className="card-id">
                <span className="ico">
                  {cipher
                    ? <WebsiteIcon cipher={cipher} fallback={<TypeIcon type={entry.type} />} />
                    : <TypeIcon type={entry.type} />}
                </span>
                <span className="who">
                  <span className="title">{entry.name}</span>
                  <span className="sub">{entry.sub}</span>
                </span>
                {entry.id === props.copiedId && <span className="nx-badge ok">✓</span>}
              </span>
              {live && (
                <span className="card-code nx-totp">
                  <span className="code nx-data">{live.code}</span>
                  <span className="ring" style={{ '--ring': `${Math.round((live.remain / live.period) * 100)}%` }} />
                  <span className="secs">{live.remain}s</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
