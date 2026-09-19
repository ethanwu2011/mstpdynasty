import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board aria-label="Loading the wall of shame">
      <Panel label="Wall of shame" span={8}>
        <div className="flex flex-col gap-6">
          <p className="type-display m-0 text-j3 text-paper-shade md:text-j4" aria-hidden>
            Most wanted
          </p>
          <DotMatrixFill state="loading" label="Adding up every bad decision." rows={10} />
        </div>
      </Panel>
      <Panel label="Rap sheets" span={4}>
        <DotMatrixFill state="loading" label="Counting entries." rows={14} ramp="ttb" />
      </Panel>
      <Panel label="All-time records">
        <DotMatrixFill state="loading" label="Checking the record book." rows={6} ramp="ltr" />
      </Panel>
    </Board>
  );
}
