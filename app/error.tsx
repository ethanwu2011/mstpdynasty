"use client";

import { Button } from "@/components/Button";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Board>
      <Panel label="Off the air" span={12}>
        <div className="flex flex-col gap-6">
          <h2 className="type-display m-0 text-j3 md:text-j4">This page did not load</h2>
          <p className="measure m-0">
            One of the data sources (Sleeper, ESPN or FantasyCalc) did not answer, or something broke on our side. Try again in a
            minute. Your league is fine.
          </p>
          <DotMatrixFill label="No signal." rows={6} density={0.3} />
          <div>
            <Button variant="primary" onClick={() => reset()}>
              Try again
            </Button>
          </div>
        </div>
      </Panel>
    </Board>
  );
}
