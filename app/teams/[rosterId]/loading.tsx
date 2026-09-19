import { MatrixLoading } from "@/components/MatrixLoading";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board>
      <Panel label="The team" span={8}>
        <MatrixLoading label="Pulling the roster from Sleeper." rows={10} />
      </Panel>
      <Panel label="Latest" span={4}>
        <MatrixLoading label="Checking the rap sheet." rows={10} />
      </Panel>
      <Panel label="Starting lineup">
        <MatrixLoading label="Pricing every player on FantasyCalc." rows={8} />
      </Panel>
    </Board>
  );
}
