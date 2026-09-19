"use client";

import { Button } from "@/components/Button";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function DraftError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Board>
      <Panel label="Draft board">
        <div className="flex flex-col gap-6">
          <h1 className="type-display m-0 text-j3 md:text-j4">The board did not load</h1>
          <p className="measure m-0">
            Sleeper or FantasyCalc did not answer, so the draft board could not load. The picks are safe on Sleeper. Try again in a
            minute.
          </p>
          <DotMatrixFill label="Sleeper did not send the draft." rows={6} density={0.3} />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => reset()}>
              Try again
            </Button>
            <Button href="/" variant="secondary">
              Back to the front page
            </Button>
          </div>
        </div>
      </Panel>
    </Board>
  );
}
