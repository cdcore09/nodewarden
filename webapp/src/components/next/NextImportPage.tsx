// NodeWarden Next (issue #16, slice 7): import inside the Next shell.
// The common path — pick a source, drop the export file (or paste its
// text), choose folder handling, import — runs natively here through the
// same lib parsers and vault callback the classic importer uses. The two
// archive ceremonies that need extra crypto (password-protected Bitwarden
// JSON, zip archives with attachments) hand off to the classic importer,
// stated plainly on the page.
import { useMemo, useRef, useState } from 'preact/hooks';
import { FileUp, ArrowRight, CheckCircle2 } from 'lucide-preact';
import { getFileAcceptBySource, IMPORT_SOURCES, type ImportSourceId } from '@/lib/import-format-sources';
import { parseImportPayloadBySource } from '@/lib/import-formats';
import type { CiphersImportPayload } from '@/lib/api/vault';
import type { ImportResultSummary } from '@/components/ImportPage';
import type { Folder } from '@/lib/types';

const STR = {
  intro: 'Everything is parsed and encrypted on this device — the export file never leaves your browser.',
  source: 'Source',
  common: 'Common',
  other: 'Everything else',
  dropTitle: 'Drop your export file here',
  dropHint: 'or click to browse',
  fileLabel: 'File',
  pasteSummary: 'Paste the export text instead',
  pasteLabel: 'Export contents',
  folders: 'Folders',
  folderOriginal: 'Keep original folders',
  folderNone: 'No folders',
  folderTarget: 'Put everything in…',
  run: 'Import',
  running: 'Importing…',
  resultTitle: 'Imported',
  resultItems: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
  resultFolders: (n: number) => `${n} folder${n === 1 ? '' : 's'}`,
  again: 'Import another file',
  toVault: 'Go to the vault',
  archiveTitle: 'Encrypted archive?',
  archiveBody: 'Password-protected Bitwarden exports and zip archives with attachments involve a master-password ceremony that stays in the classic importer.',
  archiveCta: 'Open the classic importer',
  archiveDetected: 'This file is an encrypted archive — it needs the classic importer’s password ceremony.',
  emptyFile: 'Choose a file or paste the export text first.',
};

const COMMON_SOURCE_IDS = new Set<ImportSourceId>([
  'bitwarden_json', 'bitwarden_csv', 'nodewarden_json',
  'onepassword_1pux', 'onepassword_1pif', 'protonpass_json',
  'chrome', 'edge', 'brave', 'firefox_csv', 'safari_csv',
  'lastpass', 'dashlane_csv', 'keepass_csv', 'keepass_xml', 'nordpass_csv',
]);

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isEncryptedBitwardenJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { encrypted?: unknown };
    return !!parsed && typeof parsed === 'object' && parsed.encrypted === true;
  } catch {
    return false;
  }
}

interface NextImportPageProps {
  folders: Folder[];
  onImport: (
    payload: CiphersImportPayload,
    options: { folderMode: 'original' | 'none' | 'target'; targetFolderId: string | null }
  ) => Promise<ImportResultSummary>;
  onNotify: (type: 'success' | 'error' | 'warning', text: string) => void;
  navigate: (path: string) => void;
}

export default function NextImportPage(props: NextImportPageProps) {
  const [source, setSource] = useState<ImportSourceId>('bitwarden_json');
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [folderMode, setFolderMode] = useState<'original' | 'none' | 'target'>('original');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<ImportResultSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => ({
    common: IMPORT_SOURCES.filter((s) => COMMON_SOURCE_IDS.has(s.id as ImportSourceId)),
    other: IMPORT_SOURCES.filter((s) => !COMMON_SOURCE_IDS.has(s.id as ImportSourceId)),
  }), []);

  const takeFile = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setPasted('');
    setSummary(null);
  };

  const runImport = async () => {
    if (running) return;
    let text = pasted.trim();
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isZipBytes(bytes)) {
        props.onNotify('warning', STR.archiveDetected);
        return;
      }
      text = new TextDecoder().decode(bytes);
    }
    if (!text) {
      props.onNotify('warning', STR.emptyFile);
      return;
    }
    if (isEncryptedBitwardenJson(text)) {
      props.onNotify('warning', STR.archiveDetected);
      return;
    }
    setRunning(true);
    try {
      const payload = parseImportPayloadBySource(source, text);
      const result = await props.onImport(payload, {
        folderMode,
        targetFolderId: folderMode === 'target' ? targetFolderId || null : null,
      });
      setSummary(result);
      setFile(null);
      setPasted('');
    } catch (error) {
      props.onNotify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="nx-list nx-import">
      <div className="nx-help import-intro">{STR.intro}</div>

      <div className="import-grid">
        <div className="import-main">
          {summary ? (
            <div className="import-summary" role="status">
              <div className="sum-head">
                <CheckCircle2 size={20} />
                <span className="sum-title">{STR.resultTitle}</span>
              </div>
              <div className="sum-stats">
                <div className="sum-stat">
                  <span className="n nx-data">{summary.totalItems}</span>
                  <span className="l">{STR.resultItems(summary.totalItems)}</span>
                </div>
                <div className="sum-stat">
                  <span className="n nx-data">{summary.folderCount}</span>
                  <span className="l">{STR.resultFolders(summary.folderCount)}</span>
                </div>
                {summary.typeCounts.map((tc) => (
                  <div className="sum-stat" key={tc.label}>
                    <span className="n nx-data">{tc.count}</span>
                    <span className="l">{tc.label}</span>
                  </div>
                ))}
              </div>
              <div className="sum-actions">
                <button type="button" className="nx-btn" onClick={() => props.navigate('/next')}>{STR.toVault}</button>
                <button type="button" className="nx-btn ghost" onClick={() => setSummary(null)}>{STR.again}</button>
              </div>
            </div>
          ) : (
            <div className="import-card">
              <label className="nx-field">
                <span className="nx-overline">{STR.source}</span>
                <select
                  className="nx-input"
                  value={source}
                  onInput={(e) => setSource((e.currentTarget as HTMLSelectElement).value as ImportSourceId)}
                >
                  <optgroup label={STR.common}>
                    {grouped.common.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </optgroup>
                  <optgroup label={STR.other}>
                    {grouped.other.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </optgroup>
                </select>
              </label>

              <button
                type="button"
                className={`import-drop${dragOver ? ' is-over' : ''}${file ? ' has-file' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  takeFile(e.dataTransfer?.files?.[0] || null);
                }}
              >
                <FileUp size={22} aria-hidden="true" />
                {file ? (
                  <span className="drop-file nx-data">{file.name}</span>
                ) : (
                  <>
                    <span className="drop-title">{STR.dropTitle}</span>
                    <span className="drop-hint">{STR.dropHint}</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={getFileAcceptBySource(source)}
                className="nx-sr-only"
                aria-label={STR.fileLabel}
                onChange={(e) => {
                  takeFile((e.currentTarget as HTMLInputElement).files?.[0] || null);
                  (e.currentTarget as HTMLInputElement).value = '';
                }}
              />

              <details className="nx-details" open={!!pasted}>
                <summary>{STR.pasteSummary}</summary>
                <div className="details-body">
                  <label className="nx-field">
                    <span className="nx-overline">{STR.pasteLabel}</span>
                    <textarea
                      className="nx-input nx-data import-paste"
                      value={pasted}
                      onInput={(e) => {
                        setPasted((e.currentTarget as HTMLTextAreaElement).value);
                        setFile(null);
                      }}
                    />
                  </label>
                </div>
              </details>

              <div className="nx-field">
                <span className="nx-overline">{STR.folders}</span>
                <div className="import-folders" role="radiogroup" aria-label={STR.folders}>
                  {([
                    ['original', STR.folderOriginal],
                    ['none', STR.folderNone],
                    ['target', STR.folderTarget],
                  ] as Array<['original' | 'none' | 'target', string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={folderMode === mode}
                      className={`nx-tog${folderMode === mode ? ' on' : ''}`}
                      onClick={() => setFolderMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                  {folderMode === 'target' && (
                    <select
                      className="nx-input"
                      value={targetFolderId}
                      onInput={(e) => setTargetFolderId((e.currentTarget as HTMLSelectElement).value)}
                    >
                      <option value="">—</option>
                      {props.folders.map((f) => (
                        <option key={f.id} value={f.id}>{f.decName || f.name || ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="nx-btn"
                  disabled={running || (!file && !pasted.trim())}
                  onClick={() => void runImport()}
                >
                  {running ? STR.running : STR.run}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="import-aside">
          <div className="aside-card">
            <div className="nx-overline">{STR.archiveTitle}</div>
            <div className="nx-help">{STR.archiveBody}</div>
            <button type="button" className="nx-help accent-link" onClick={() => props.navigate('/import')}>
              {STR.archiveCta} <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
