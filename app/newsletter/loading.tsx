import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board aria-label="Loading the newsletter archive">
      <Panel label="The latest issue" span={8}>
        <div className="flex flex-col gap-6">
          <p className="type-display m-0 text-j3 text-paper-shade md:text-j4" aria-hidden>
            The newsletter
          </p>
          <DotMatrixFill state="loading" label="Pulling the archive." rows={10} />
        </div>
      </Panel>
      <Panel label="The four issues" span={4}>
        <DotMatrixFill state="loading" label="Counting issues." rows={12} ramp="ttb" />
      </Panel>
    </Board>
  );
}
