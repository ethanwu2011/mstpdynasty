import { Button } from "@/components/Button";
import { Numeral } from "@/components/Numeral";
import { Board, Panel } from "@/components/Panel";

export default function NotFound() {
  return (
    <Board>
      <Panel label="Not found" span={12}>
        <div className="flex flex-col gap-6">
          <Numeral value="404" size="d100" label="Error 404" />
          <h1 className="type-display m-0 text-j3 md:text-j4">No page here</h1>
          <p className="measure m-0">That link points at nothing.</p>
          <div>
            <Button href="/" variant="secondary">
              Back to the front page
            </Button>
          </div>
        </div>
      </Panel>
    </Board>
  );
}
