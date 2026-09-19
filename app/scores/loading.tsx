import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";

export default function ScoresLoading() {
  return (
    <Board>
      <PageHead bar="Scoreboard" title="Scores" meta={<span>Pulling the week from Sleeper</span>} />
      <Panel label="Matchups" span={12}>
        <DotMatrixFill state="loading" label="Loading every matchup, every starter, every point." rows={10} />
      </Panel>
    </Board>
  );
}
