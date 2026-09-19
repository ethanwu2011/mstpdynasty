import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";

export default function StandingsLoading() {
  return (
    <Board>
      <PageHead bar="Standings" title="Standings" meta={<span>Pulling the table from Sleeper</span>} />
      <Panel label="Standings">
        <DotMatrixFill state="loading" label="Loading records, points and luck." rows={10} />
      </Panel>
    </Board>
  );
}
