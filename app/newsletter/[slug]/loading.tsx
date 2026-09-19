import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function Loading() {
  return (
    <Board aria-label="Loading the issue">
      <Panel label="The Roast">
        <div className="flex flex-col gap-6">
          <p className="type-display m-0 text-j3 text-paper-shade md:text-j4 xl:text-j5" aria-hidden>
            Printing
          </p>
          <DotMatrixFill state="loading" label="Pulling the issue from the archive." rows={8} />
        </div>
      </Panel>
    </Board>
  );
}
