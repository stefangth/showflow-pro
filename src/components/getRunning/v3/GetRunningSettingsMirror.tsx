import { GetRunningBoardV3 } from "./GetRunningBoardV3";

/** Settings → Get running mirror: the same v3 board the standalone page renders, in the
 *  settings content frame. */
export function GetRunningSettingsMirror(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <GetRunningBoardV3 context="settings" />
    </div>
  );
}
