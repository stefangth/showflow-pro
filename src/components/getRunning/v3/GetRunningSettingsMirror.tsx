import { GetRunningBoardV3 } from "./GetRunningBoardV3";
import { GetRunningV3Toggle } from "./GetRunningV3Toggle";

/** Settings → Get running mirror: the super-admin runtime toggle above the same
 *  v3 board the standalone page renders, in the settings content frame. */
export function GetRunningSettingsMirror(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <GetRunningV3Toggle />
      <GetRunningBoardV3 context="settings" />
    </div>
  );
}
