/** Whether the current viewer may sign this order in-app: the linked artist,
 *  on an issued order, when the org is in electronic countersign mode. */
export function canArtistSign(args: {
  canManage: boolean;
  status: string;
  mode: string;
  isLinkedArtist: boolean;
}): boolean {
  return !args.canManage && args.status === "issued" && args.mode === "electronic" && args.isLinkedArtist;
}
