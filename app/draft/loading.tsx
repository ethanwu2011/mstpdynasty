import { MatrixLoading } from "@/components/MatrixLoading";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board>
      <Panel label="Startup draft" span={8}>
        <MatrixLoading label="Pulling the draft from Sleeper." rows={10} />
      </Panel>
      <Panel label="How the order runs" span={4}>
        <MatrixLoading label="Reading the draft order." rows={10} />
      </Panel>
      <Panel label="The board">
        <MatrixLoading label="Lighting up the board." rows={16} />
      </Panel>
    </Board>
  );
}
