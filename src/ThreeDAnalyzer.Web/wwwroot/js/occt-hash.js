/**
 * Shared OCCT face-hash upper bound.
 * MUST match whatever meshShape() embeds in faceGroups — Integer.MAX_VALUE
 * (2147483647). Using 1<<30 makes most faceGroups hashes miss AAG nodes,
 * which breaks user-hinted picking and hash remapping after defeature.
 */
export const OCCT_HASH_UPPER = 2147483647;
