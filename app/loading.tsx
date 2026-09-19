import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board>
      <Panel label="Loading" span={12}>
        <DotMatrixFill state="loading" label="Pulling the league from Sleeper." rows={12} />
      </Panel>
    </Board>
  );
}
