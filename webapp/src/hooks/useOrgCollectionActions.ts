import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  createOrgCollection,
  deleteOrgCollection,
  getOrgCollectionUsers,
  listOrgCollections,
  putOrgCollectionUsers,
  updateOrgCollection,
  type OrgCollectionGrant,
} from '@/lib/api/organizations';
import { decryptWithOrgKey, encryptWithOrgKey } from '@/lib/org-crypto';
import { t } from '@/lib/i18n';

type Notify = (type: 'success' | 'error' | 'warning', text: string) => void;

export interface OrgCollectionRow {
  id: string;
  /** Decrypted display name; null when the org key is missing or decryption fails. */
  name: string | null;
}

interface UseOrgCollectionActionsOptions {
  authedFetch: AuthedFetch;
  orgId: string;
  orgKeys: Record<string, Uint8Array>;
  onNotify?: Notify;
}

// Collection names are org-key EncStrings; every name operation goes through
// the org key and fails closed when it is not unlocked (same rule as the
// member confirm flow).
export function useOrgCollectionActions(opts: UseOrgCollectionActionsOptions) {
  const [collections, setCollections] = useState<OrgCollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orgKey = opts.orgKeys[opts.orgId];

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaries = await listOrgCollections(opts.authedFetch, opts.orgId);
      const rows: OrgCollectionRow[] = [];
      for (const summary of summaries) {
        let name: string | null = null;
        if (orgKey) {
          try {
            name = await decryptWithOrgKey(summary.name, orgKey);
          } catch {
            name = null;
          }
        }
        rows.push({ id: summary.id, name });
      }
      setCollections(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, [opts.authedFetch, opts.orgId, orgKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requireOrgKey = useCallback((): Uint8Array => {
    const key = opts.orgKeys[opts.orgId];
    if (!key) throw new Error(t('txt_org_key_unavailable'));
    return key;
  }, [opts.orgKeys, opts.orgId]);

  const create = useCallback(
    async (name: string) => {
      const key = requireOrgKey();
      const enc = await encryptWithOrgKey(name, key);
      await createOrgCollection(opts.authedFetch, opts.orgId, enc);
      await reload();
      opts.onNotify?.('success', t('txt_org_collection_created'));
    },
    [opts.authedFetch, opts.orgId, requireOrgKey, reload]
  );

  const rename = useCallback(
    async (collectionId: string, name: string) => {
      const key = requireOrgKey();
      const enc = await encryptWithOrgKey(name, key);
      await updateOrgCollection(opts.authedFetch, opts.orgId, collectionId, enc);
      await reload();
      opts.onNotify?.('success', t('txt_org_collection_renamed'));
    },
    [opts.authedFetch, opts.orgId, requireOrgKey, reload]
  );

  const remove = useCallback(
    async (collectionId: string) => {
      await deleteOrgCollection(opts.authedFetch, opts.orgId, collectionId);
      await reload();
      opts.onNotify?.('success', t('txt_org_collection_deleted'));
    },
    [opts.authedFetch, opts.orgId, reload]
  );

  const loadGrants = useCallback(
    async (collectionId: string): Promise<OrgCollectionGrant[]> => {
      return getOrgCollectionUsers(opts.authedFetch, opts.orgId, collectionId);
    },
    [opts.authedFetch, opts.orgId]
  );

  const saveGrants = useCallback(
    async (collectionId: string, grants: OrgCollectionGrant[]) => {
      await putOrgCollectionUsers(opts.authedFetch, opts.orgId, collectionId, grants);
      opts.onNotify?.('success', t('txt_org_access_updated'));
    },
    [opts.authedFetch, opts.orgId]
  );

  return { collections, loading, error, reload, create, rename, remove, loadGrants, saveGrants };
}

export default useOrgCollectionActions;
