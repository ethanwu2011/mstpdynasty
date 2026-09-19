import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";

export default function OddsLoading() {
  return (
    <Board>
      <PageHead bar="Season simulator" title="Odds" meta={<span>Playing out the rest of the season</span>} />
      <Panel label="The odds">
        <DotMatrixFill state="loading" label="Running 10,000 seasons. This takes a second." rows={10} />
      </Panel>
    </Board>
  );
}
