import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board aria-label="Loading trades">
      <Panel label="The latest trade" span={8}>
        <div className="flex flex-col gap-6">
          <p className="type-display m-0 text-j3 text-paper-shade md:text-j4" aria-hidden>
            Grading
          </p>
          <DotMatrixFill state="loading" label="Pricing every trade on FantasyCalc." rows={10} />
        </div>
      </Panel>
      <Panel label="Trade balance" span={4}>
        <DotMatrixFill state="loading" label="Adding up who keeps paying." rows={12} ramp="ttb" />
      </Panel>
    </Board>
  );
}
